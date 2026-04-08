import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Katakana Reading Experiment MVP
 * - Pure frontend React single-file prototype
 * - Flow: setup -> countdown -> recording -> survey -> done/export
 * - One audio file per trial
 * - Export: results.json + audio blobs downloaded individually (MVP)
 */

type Phase = 'setup' | 'countdown' | 'recording' | 'survey' | 'done';

type StimulusItem = {
  id: string;
  text: string;
};

type SurveyResponse = {
  meaningText: string;
  familiarity: number;
  confidence: number;
  exposureFreq: number;
  useFreq: number;
};

type TrialResult = {
  trialIndex: number;
  stimulusId: string;
  stimulusText: string;
  length: number;
  stimOnsetMs: number;
  recordStartMs: number;
  recordStopMs: number;
  rtKeyMs: number;
  audioMime: string;
  audioExt: string;
  audioFile: string;
  audioBlob: Blob;
  responses: SurveyResponse;
};

type ExperimentMeta = {
  subjectId: string;
  startTimeIso: string;
  endTimeIso?: string;
  audioMimeChosen?: string;
  stimulusOrder: string[];
  browser: string;
};

const STIMULI: StimulusItem[] = [
  { id: 'w001', text: 'ナショナリズム' },
  { id: 'w002', text: 'コミュニティ' },
  { id: 'w003', text: 'モチベーション' },
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getBrowserLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  return navigator.userAgent;
}

function pickBestAudioMimeType(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
  ];

  for (const item of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(item.mimeType)) {
      return item;
    }
  }
  return { mimeType: '', ext: 'webm' };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function likertOptions() {
  return [1, 2, 3, 4, 5];
}

function App() {
  const orderedStimuli = useMemo(() => shuffle(STIMULI), []);
  const [phase, setPhase] = useState<Phase>('setup');
  const [subjectId, setSubjectId] = useState('');
  const [streamReady, setStreamReady] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [currentTrialIndex, setCurrentTrialIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [results, setResults] = useState<TrialResult[]>([]);
  const [meta, setMeta] = useState<ExperimentMeta | null>(null);
  const [tempRecording, setTempRecording] = useState<{
    trialIndex: number;
    stimulus: StimulusItem;
    stimOnsetMs: number;
    recordStartMs: number;
    recordStopMs?: number;
    audioBlob?: Blob;
    audioMime?: string;
    audioExt?: string;
    audioFile?: string;
  } | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const currentStimulus = orderedStimuli[currentTrialIndex];
  const progressPercent = ((currentTrialIndex + (phase === 'done' ? 1 : 0)) / orderedStimuli.length) * 100;

  async function requestMic() {
    try {
      setPermissionError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setStreamReady(true);
    } catch (error) {
      console.error(error);
      setPermissionError('マイク権限の取得に失敗しました。ブラウザ設定を確認してください。');
      setStreamReady(false);
    }
  }

  function startExperiment() {
    if (!subjectId.trim()) {
      alert('Subject ID を入力してください。');
      return;
    }
    if (!streamReady) {
      alert('先にマイク権限を許可してください。');
      return;
    }
    const chosen = pickBestAudioMimeType();
    setMeta({
      subjectId: subjectId.trim(),
      startTimeIso: new Date().toISOString(),
      audioMimeChosen: chosen.mimeType,
      stimulusOrder: orderedStimuli.map((s) => s.id),
      browser: getBrowserLabel(),
    });
    setPhase('countdown');
    setCountdown(3);
  }

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      const stimulus = orderedStimuli[currentTrialIndex];
      const chosen = pickBestAudioMimeType();
      chunksRef.current = [];

      const stimOnsetMs = performance.now();
      const recorder = chosen.mimeType
        ? new MediaRecorder(mediaStreamRef.current as MediaStream, { mimeType: chosen.mimeType })
        : new MediaRecorder(mediaStreamRef.current as MediaStream);

      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setTempRecording({
        trialIndex: currentTrialIndex + 1,
        stimulus,
        stimOnsetMs,
        recordStartMs: stimOnsetMs,
        audioMime: chosen.mimeType || recorder.mimeType || 'audio/webm',
        audioExt: chosen.ext,
        audioFile: `trial_${String(currentTrialIndex + 1).padStart(3, '0')}.${chosen.ext}`,
      });
      setPhase('recording');
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phase, countdown, orderedStimuli, currentTrialIndex]);

  useEffect(() => {
    if (phase !== 'recording') return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      event.preventDefault();
      stopCurrentRecording();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, tempRecording]);

  function stopCurrentRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording' || !tempRecording) return;

    const stopMs = performance.now();
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: tempRecording.audioMime || recorder.mimeType || 'audio/webm',
      });
      setTempRecording((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          recordStopMs: stopMs,
          audioBlob: blob,
        };
      });
      setPhase('survey');
    };
    recorder.stop();
  }

  function submitSurvey(response: SurveyResponse) {
    if (!tempRecording?.audioBlob || tempRecording.recordStopMs == null) {
      alert('録音データが不完全です。');
      return;
    }

    const result: TrialResult = {
      trialIndex: tempRecording.trialIndex,
      stimulusId: tempRecording.stimulus.id,
      stimulusText: tempRecording.stimulus.text,
      length: tempRecording.stimulus.text.length,
      stimOnsetMs: tempRecording.stimOnsetMs,
      recordStartMs: tempRecording.recordStartMs,
      recordStopMs: tempRecording.recordStopMs,
      rtKeyMs: tempRecording.recordStopMs - tempRecording.stimOnsetMs,
      audioMime: tempRecording.audioMime || 'audio/webm',
      audioExt: tempRecording.audioExt || 'webm',
      audioFile: tempRecording.audioFile || `trial_${String(tempRecording.trialIndex).padStart(3, '0')}.webm`,
      audioBlob: tempRecording.audioBlob,
      responses: response,
    };

    setResults((prev) => [...prev, result]);
    setTempRecording(null);

    const isLast = currentTrialIndex >= orderedStimuli.length - 1;
    if (isLast) {
      setMeta((prev) => (prev ? { ...prev, endTimeIso: new Date().toISOString() } : prev));
      setPhase('done');
    } else {
      setCurrentTrialIndex((prev) => prev + 1);
      setCountdown(3);
      setPhase('countdown');
    }
  }

  function exportResultsJson() {
    if (!meta) return;
    const exportable = {
      meta,
      trials: results.map((r) => ({
        trialIndex: r.trialIndex,
        stimulusId: r.stimulusId,
        stimulusText: r.stimulusText,
        length: r.length,
        stimOnsetMs: r.stimOnsetMs,
        recordStartMs: r.recordStartMs,
        recordStopMs: r.recordStopMs,
        rtKeyMs: r.rtKeyMs,
        audioMime: r.audioMime,
        audioExt: r.audioExt,
        audioFile: r.audioFile,
        responses: r.responses,
      })),
    };

    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${meta.subjectId || 'subject'}_results.json`);
  }

  function exportAllAudio() {
    results.forEach((r) => {
      downloadBlob(r.audioBlob, r.audioFile);
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <TopBar
          subjectId={subjectId}
          phase={phase}
          currentTrialIndex={currentTrialIndex}
          totalTrials={orderedStimuli.length}
          progressPercent={progressPercent}
        />

        <main className="flex flex-1 items-center justify-center py-6">
          {phase === 'setup' && (
            <CardShell className="max-w-3xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Katakana Reading Experiment</Badge>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    実験の準備
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                    被験者情報を入力し、マイク権限を許可してから実験を開始します。現在の MVP では、各 trial の録音と回答をローカルに保存できます。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                    <label className="mb-2 block text-sm font-medium text-slate-200">Subject ID</label>
                    <input
                      className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      placeholder="例: S001"
                    />

                    <div className="mt-5 flex flex-wrap gap-3">
                      <PrimaryButton onClick={startExperiment}>実験開始</PrimaryButton>
                      <SecondaryButton onClick={requestMic}>マイク権限を許可</SecondaryButton>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                    <div className="space-y-4 text-sm">
                      <StatusRow label="マイク状態" value={streamReady ? '準備完了' : '未許可'} success={streamReady} />
                      <StatusRow label="試行数" value={String(orderedStimuli.length)} />
                      <StatusRow label="録音形式" value={pickBestAudioMimeType().mimeType || 'browser default'} />
                      {permissionError ? (
                        <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-rose-200">
                          {permissionError}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-emerald-200">
                          実験前にブラウザのマイク権限が有効か確認してください。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'countdown' && (
            <CardShell className="max-w-2xl text-center">
              <div className="space-y-8">
                <Badge>Trial {currentTrialIndex + 1} / {orderedStimuli.length}</Badge>
                <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-full border border-sky-300/30 bg-sky-400/10 text-8xl font-semibold text-white shadow-2xl shadow-sky-500/20">
                  {countdown}
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-white">まもなく単語が表示されます</h2>
                  <p className="text-sm leading-7 text-slate-300">
                    カウントダウン中はそのままお待ちください。表示後、単語を読み上げたら Space キーで次へ進みます。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'recording' && (
            <CardShell className="max-w-4xl text-center">
              <div className="space-y-10">
                <div className="space-y-3">
                  <Badge>Recording</Badge>
                  <div className="text-sm text-slate-400">Trial {currentTrialIndex + 1} / {orderedStimuli.length}</div>
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-white/5 px-6 py-10 shadow-2xl shadow-slate-900/30">
                  <div className="mx-auto mb-6 flex h-3 w-3 rounded-full bg-rose-400 shadow-[0_0_20px_rgba(251,113,133,0.8)]" />
                  <div className="break-words text-4xl font-semibold tracking-[0.08em] text-white sm:text-6xl">
                    {currentStimulus.text}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xl font-medium text-white">読み上げてください</p>
                  <p className="text-sm leading-7 text-slate-300">
                    読み終わったら <span className="rounded-lg bg-white/10 px-2 py-1 text-slate-100">Space</span> キー、または下のボタンを押してください。
                  </p>
                </div>

                <div className="flex justify-center">
                  <PrimaryButton onClick={stopCurrentRecording}>次へ進む</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'survey' && tempRecording && (
            <SurveyForm stimulus={tempRecording.stimulus.text} onSubmit={submitSurvey} />
          )}

          {phase === 'done' && (
            <CardShell className="max-w-3xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Completed</Badge>
                  <h2 className="text-3xl font-semibold tracking-tight text-white">実験完了</h2>
                  <p className="text-sm leading-7 text-slate-300">
                    すべての trial が保存されました。MVP では JSON と音声を個別にダウンロードできます。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoCard label="保存済み trial 数" value={String(results.length)} />
                  <InfoCard label="Subject ID" value={meta?.subjectId || '-'} />
                </div>

                <div className="flex flex-wrap gap-3">
                  <PrimaryButton onClick={exportResultsJson}>results.json をダウンロード</PrimaryButton>
                  <SecondaryButton onClick={exportAllAudio}>音声ファイルをダウンロード</SecondaryButton>
                </div>
              </div>
            </CardShell>
          )}
        </main>
      </div>
    </div>
  );
}

function SurveyForm({
  stimulus,
  onSubmit,
}: {
  stimulus: string;
  onSubmit: (response: SurveyResponse) => void;
}) {
  const [meaningText, setMeaningText] = useState('');
  const [familiarity, setFamiliarity] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [exposureFreq, setExposureFreq] = useState<number | null>(null);
  const [useFreq, setUseFreq] = useState<number | null>(null);

  function submit() {
    if (familiarity == null || confidence == null || exposureFreq == null || useFreq == null) {
      alert('Q2〜Q5 をすべて選択してください。');
      return;
    }

    onSubmit({
      meaningText,
      familiarity,
      confidence,
      exposureFreq,
      useFreq,
    });
  }

  return (
    <CardShell className="max-w-4xl">
      <div className="space-y-8">
        <div className="space-y-3">
          <Badge>Post-trial Survey</Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white">事後質問</h2>
          <p className="text-sm leading-7 text-slate-300">
            対象語: <span className="font-semibold text-white">{stimulus}</span>
          </p>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <label className="mb-3 block text-sm font-medium text-slate-200">Q1. 単語の意味は？</label>
          <textarea
            className="min-h-32 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
            value={meaningText}
            onChange={(e) => setMeaningText(e.target.value)}
            placeholder="自由記述（わからない場合は空欄でも可）"
          />
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <LikertQuestion label="Q2. なじみ度" value={familiarity} onChange={setFamiliarity} />
          <LikertQuestion label="Q3. 意味理解自信度" value={confidence} onChange={setConfidence} />
          <LikertQuestion label="Q4. 普段の見聞き頻度" value={exposureFreq} onChange={setExposureFreq} />
          <LikertQuestion label="Q5. 自分で使う頻度" value={useFreq} onChange={setUseFreq} />
        </div>

        <div className="flex justify-end">
          <PrimaryButton onClick={submit}>次の trial へ</PrimaryButton>
        </div>
      </div>
    </CardShell>
  );
}

function TopBar({
  subjectId,
  phase,
  currentTrialIndex,
  totalTrials,
  progressPercent,
}: {
  subjectId: string;
  phase: Phase;
  currentTrialIndex: number;
  totalTrials: number;
  progressPercent: number;
}) {
  return (
    <header className="sticky top-0 z-10 mb-4">
      <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 px-4 py-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Experiment Panel</div>
            <div className="mt-1 text-sm text-slate-300">
              {subjectId ? `Subject: ${subjectId}` : 'Subject ID not set'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MiniPill label="Phase" value={phase} />
            <MiniPill label="Trial" value={`${Math.min(currentTrialIndex + (phase === 'done' ? 1 : 0), totalTrials)}/${totalTrials}`} />
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 transition-all duration-500"
            style={{ width: `${Math.max(progressPercent, phase === 'setup' ? 0 : 8)}%` }}
          />
        </div>
      </div>
    </header>
  );
}

function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`w-full rounded-[2rem] border border-white/10 bg-slate-900/75 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8 ${className}`}
    >
      {children}
    </section>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:-translate-y-0.5 hover:bg-slate-100 active:translate-y-0"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-white/10 active:translate-y-0"
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex w-fit items-center rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-sky-200">
      {children}
    </div>
  );
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-medium text-slate-100">{value}</span>
    </div>
  );
}

function StatusRow({ label, value, success = false }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/40 px-4 py-3">
      <span className="text-slate-400">{label}</span>
      <span className={`font-medium ${success ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function LikertQuestion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <div className="mb-4 text-sm font-medium text-slate-200">{label}</div>
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {likertOptions().map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`rounded-2xl border px-0 py-3 text-sm font-medium transition ${value === n
              ? 'border-sky-300/40 bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/25'
              : 'border-white/10 bg-slate-950/50 text-slate-200 hover:bg-white/10'
              }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-xs text-slate-500">
        <span>低い</span>
        <span>高い</span>
      </div>
    </section>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
      <div className="absolute right-0 top-40 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
    </div>
  );
}

export default App;
