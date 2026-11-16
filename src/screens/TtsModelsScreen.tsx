import { useEffect, useState } from 'react';
import { TTS_MODELS, type TtsModel } from '../../shared/ttsModels.ts';
import { ttsModelsRequest } from '../lib/ttsModelsApi.ts';
import './TtsModelsScreen.css';

export default function TtsModelsScreen({ onGoHome }: { onGoHome: () => void }) {
  const [model, setModel] = useState<TtsModel | null>(null);
  const [savedModel, setSavedModel] = useState<TtsModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setMessage('');
    ttsModelsRequest(undefined, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setModel(value); setSavedModel(value); setStatus('ready');
    }).catch(() => {
      if (!controller.signal.aborted) { setMessage('음성 모델 설정을 불러오지 못했습니다.'); setStatus('error'); }
    });
    return () => controller.abort();
  }, [retry]);
  const save = async () => {
    if (!model || status !== 'ready') return;
    setStatus('saving'); setMessage(''); setSaved(false);
    try {
      const value = await ttsModelsRequest(model);
      setModel(value); setSavedModel(value); setSaved(true);
    } catch { setMessage('저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setStatus('ready'); }
  };
  return <section className="register-screen" aria-labelledby="tts-models-title">
    <header className="register-header">
      <button type="button" className="register-back" disabled={status === 'saving'} onClick={onGoHome}>홈으로</button>
      <h1 id="tts-models-title" className="register-title">음성모델교체</h1>
    </header>
    <p className="register-hint">사용할 모델 하나를 선택하고 저장하세요. 모든 중국어 프로필에 적용됩니다.</p>
    <p className="register-hint">모델마다 음색과 발음이 달라질 수 있습니다. 무료 잔여량은 Qwen 콘솔에서 확인하세요.</p>
    {status === 'loading' && <p role="status">설정을 불러오는 중…</p>}
    {message && <p role="alert" className="register-error">{message}</p>}
    {status === 'error' && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>}
    {(status === 'ready' || status === 'saving') && <>
      <fieldset className="tts-model-options" disabled={status === 'saving'}>
        <legend>음성 모델</legend>
        {TTS_MODELS.map((item) => <label key={item} className="tts-model-option">
          <input type="radio" name="tts-model" value={item} checked={model === item} onChange={() => { setModel(item); setSaved(false); setMessage(''); }} />
          <span>{item}{savedModel === item && <small>현재 적용 중</small>}</span>
        </label>)}
      </fieldset>
      <button type="button" className="register-confirm-button" onClick={() => void save()} disabled={status === 'saving' || model === savedModel}>{status === 'saving' ? '저장 중…' : '저장'}</button>
      {saved && <p role="status">저장했습니다. 이후 음성 요청부터 적용됩니다.</p>}
    </>}
  </section>;
}
