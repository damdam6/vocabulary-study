/**
 * 구글 서비스 계정 인증 — 키 JSON으로 JWT(RS256)를 서명해 access token 교환.
 * Workers에는 Node crypto가 없으므로 Web Crypto API(crypto.subtle)로 서명한다.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
// 만료 직전 토큰으로 시트 호출 중 만료되는 것을 막는 여유분
const EXPIRY_BUFFER_MS = 60_000;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

// isolate 수명 동안 유지되는 모듈 스코프 캐시. isolate 교체 시 재발급되는 건 정상.
let cached: { token: string; expiresAt: number } | null = null;
// 동시 요청이 각자 토큰을 발급받지 않도록 진행 중인 발급을 공유
let inFlight: Promise<string> | null = null;

export async function getAccessToken(env: Env): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
    console.log("[google-auth] token cache hit");
    return cached.token;
  }
  if (inFlight) {
    console.log("[google-auth] joining in-flight token request");
    return inFlight;
  }
  inFlight = issueToken(env)
    .then((issued) => {
      cached = issued;
      return issued.token;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function issueToken(env: Env): Promise<{ token: string; expiresAt: number }> {
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY) as ServiceAccountKey;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  }

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(JSON.stringify(claims))}`;

  const privateKey = await importPrivateKey(key.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`[google-auth] token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as TokenResponse;
  console.log(`[google-auth] token issued (expires_in=${body.expires_in}s)`);
  return { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("private_key is not a valid PKCS#8 PEM");
  }
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
