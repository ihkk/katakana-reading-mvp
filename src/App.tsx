import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Katakana Reading Experiment MVP (Light Theme + Instructions + Practice)
 * Flow:
 * setup -> instructions -> [ practice loop ] -> intermission -> [ main loop ] -> done
 * Loop: countdown -> recording(read aloud) -> meaningRecording(oral meaning) -> survey(likert)
 */

type Phase =
  | 'setup'
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'meaningRecording'
  | 'survey'
  | 'intermission'
  | 'done';

type ExperimentMode = 'practice' | 'main';

type StimulusItem = {
  id: string;
  text: string;
};

type SurveyResponse = {
  familiarity: number;
  confidence: number;
  exposureFreq: number;
  useFreq: number;
};

type TrialResult = {
  mode: ExperimentMode;
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
  meaningRecordStartMs: number;
  meaningRecordStopMs: number;
  meaningRtMs: number;
  meaningAudioMime: string;
  meaningAudioExt: string;
  meaningAudioFile: string;
  meaningAudioBlob: Blob;
  responses: SurveyResponse;
};

type ExperimentMeta = {
  subjectId: string;
  startTimeIso: string;
  endTimeIso?: string;
  audioMimeChosen?: string;
  mainStimulusOrder: string[];
  practiceStimulusOrder: string[];
  browser: string;
};

type TempReadingRecording = {
  trialIndex: number;
  stimulus: StimulusItem;
  stimOnsetMs: number;
  recordStartMs: number;
  recordStopMs?: number;
  audioBlob?: Blob;
  audioMime?: string;
  audioExt?: string;
  audioFile?: string;
};

type TempMeaningRecording = {
  startMs?: number;
  stopMs?: number;
  audioBlob?: Blob;
  audioMime?: string;
  audioExt?: string;
  audioFile?: string;
};

// practice stimuli
const PRACTICE_STIMULI: StimulusItem[] = [
  { id: 'p001', text: 'パソコン' },
  { id: 'p002', text: 'てれび' },
];

// formal stimuli
const MAIN_STIMULI: StimulusItem[] = [
  { id: 'w001', text: 'エラー' },
  { id: 'w002', text: 'きんぐ' },
  { id: 'w003', text: 'フロア' },
  { id: 'w004', text: 'ぱすた' },
  { id: 'w005', text: 'シナリオ' },
  { id: 'w006', text: 'どらごん' },
  { id: 'w007', text: 'ダメージ' },
  { id: 'w008', text: 'ろーかる' },
  { id: 'w009', text: 'ポジション' },
  { id: 'w010', text: 'かめらまん' },
  { id: 'w011', text: 'ストリート' },
  { id: 'w012', text: 'こんぱくと' },
  { id: 'w013', text: 'ステーション' },
  { id: 'w014', text: 'ぷらいばしー' },
  { id: 'w015', text: 'パンフレット' },
  { id: 'w016', text: 'へりこぷたー' },
  { id: 'w017', text: 'ジャーナリスト' },
  { id: 'w018', text: 'いんふるえんざ' },
  { id: 'w019', text: 'マーケティング' },
  { id: 'w020', text: 'はーどでぃすく' },
  { id: 'w021', text: 'シミュレーション' },
  { id: 'w022', text: 'どきゅめんたりー' },
  { id: 'w023', text: 'ファンデーション' },
  { id: 'w024', text: 'しちゅえーしょん' },
  { id: 'w025', text: 'アイデンティティー' },
  { id: 'w026', text: 'いんふぉめーしょん' },
  { id: 'w027', text: 'プレゼンテーション' },
  { id: 'w028', text: 'すーぱーまーけっと' },
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
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
  ];

  for (const item of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(item.mimeType)
    ) {
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

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 3000);
}

function likertOptions() {
  return [1, 2, 3, 4, 5];
}

function App() {
  const orderedMainStimuli = useMemo(() => shuffle(MAIN_STIMULI), []);
  const orderedPracticeStimuli = useMemo(() => PRACTICE_STIMULI, []); // 练习通常不打乱

  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<ExperimentMode>('practice');
  const [subjectId, setSubjectId] = useState('');

  const [streamReady, setStreamReady] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const [currentTrialIndex, setCurrentTrialIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);

  const [practiceResults, setPracticeResults] = useState<TrialResult[]>([]);
  const [mainResults, setMainResults] = useState<TrialResult[]>([]);
  const [meta, setMeta] = useState<ExperimentMeta | null>(null);

  const [tempReading, setTempReading] = useState<TempReadingRecording | null>(null);
  const [tempMeaning, setTempMeaning] = useState<TempMeaningRecording | null>(null);
  const [isMeaningRecording, setIsMeaningRecording] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const activeStimuli = mode === 'practice' ? orderedPracticeStimuli : orderedMainStimuli;
  const currentStimulus = activeStimuli[currentTrialIndex];

  const currentResults = mode === 'practice' ? practiceResults : mainResults;
  const completedTrials = currentResults.length;
  const progressPercent = (completedTrials / activeStimuli.length) * 100;

  async function requestMic() {
    try {
      setPermissionError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      mediaStreamRef.current = stream;
      setStreamReady(true);

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputs);

      if (audioInputs.length > 0) {
        const activeTrack = stream.getAudioTracks()[0];
        const activeDeviceId = activeTrack?.getSettings().deviceId;
        setSelectedDeviceId(activeDeviceId || audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error(error);
      setPermissionError('マイク権限の取得に失敗しました。ブラウザ設定を確認してください。');
      setStreamReady(false);
    }
  }

  async function switchMicrophone(newDeviceId: string) {
    setSelectedDeviceId(newDeviceId);
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: newDeviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      mediaStreamRef.current = newStream;
      setStreamReady(true);
    } catch (error) {
      console.error("マイクの切り替えに失敗しました:", error);
      setPermissionError('選択したマイクの起動に失敗しました。');
      setStreamReady(false);
    }
  }

  function startExperiment() {
    if (!subjectId.trim()) {
      alert('Subject ID を入力してください。');
      return;
    }
    if (!streamReady || !mediaStreamRef.current) {
      alert('先にマイク権限を許可してください。');
      return;
    }

    const chosen = pickBestAudioMimeType();
    setMeta({
      subjectId: subjectId.trim(),
      startTimeIso: new Date().toISOString(),
      audioMimeChosen: chosen.mimeType,
      mainStimulusOrder: orderedMainStimuli.map((s) => s.id),
      practiceStimulusOrder: orderedPracticeStimuli.map((s) => s.id),
      browser: getBrowserLabel(),
    });

    // 进入说明环节
    setPhase('instructions');
  }

  function beginPractice() {
    setMode('practice');
    setCurrentTrialIndex(0);
    setPracticeResults([]);
    setCountdown(3);
    setPhase('countdown');
  }

  function beginMainExperiment() {
    setMode('main');
    setCurrentTrialIndex(0);
    setMainResults([]);
    setCountdown(3);
    setPhase('countdown');
  }

  useEffect(() => {
    if (phase !== 'countdown') return;

    if (countdown <= 0) {
      beginReadingRecording_V2();
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  useEffect(() => {
    if (phase !== 'recording') return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      event.preventDefault();
      stopReadingRecording_V2();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, tempReading]);

  useEffect(() => {
    if (phase !== 'meaningRecording') return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || !isMeaningRecording) return;
      event.preventDefault();
      stopMeaningRecording_V2();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, isMeaningRecording, tempMeaning]);

  function createRecorder() {
    const stream = mediaStreamRef.current;
    if (!stream) {
      throw new Error('Microphone stream not ready');
    }

    const chosen = pickBestAudioMimeType();
    const recorder = chosen.mimeType
      ? new MediaRecorder(stream, { mimeType: chosen.mimeType })
      : new MediaRecorder(stream);

    return {
      recorder,
      mimeType: chosen.mimeType || recorder.mimeType || 'audio/webm',
      ext: chosen.ext || 'webm',
    };
  }

  function beginReadingRecording() {
    const stimulus = activeStimuli[currentTrialIndex];
    const localChunks: Blob[] = [];

    const { recorder, mimeType, ext } = createRecorder();
    const stimOnsetMs = performance.now();

    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        localChunks.push(event.data);
      }
    };

    const prefix = mode === 'practice' ? 'practice' : 'trial';
    const filename = `${prefix}_${String(currentTrialIndex + 1).padStart(3, '0')}_reading.${ext}`;

    recorder.start(250);
    setTempReading({
      trialIndex: currentTrialIndex + 1,
      stimulus,
      stimOnsetMs,
      recordStartMs: stimOnsetMs,
      audioMime: mimeType,
      audioExt: ext,
      audioFile: filename,
    });
    setPhase('recording');
  }

  function stopReadingRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording' || !tempReading) return;

    const stopMs = performance.now();
    recorder.onstop = () => {
      // 在闭包内部收集数据，避免并发覆盖
      const currentChunks = [];
      const blob = new Blob(currentChunks, { // 这里简化了获取，实际上应该用 localChunks，为了避免重构过深，我们依赖之前的状态
        type: tempReading.audioMime || recorder.mimeType || 'audio/webm',
      });
      // 这里的正确做法是把 localChunks 通过参数或状态传递。为了简洁，我们这里假设 chunksRef 的逻辑已在前面修复为局部变量或在 ondataavailable 处理。
    };

    // 修复局部 chunks 的完整实现
    recorder.onstop = () => { /* 将在下方修复函数中整体给出 */ };
    recorder.stop();
  }

  // -------------------------------------------------------------
  // 修改后的 begin/stop 配合局部 chunks (最佳实践)
  const readingChunksRef = useRef<Blob[]>([]);
  const meaningChunksRef = useRef<Blob[]>([]);

  function beginReadingRecording_V2() {
    const stimulus = activeStimuli[currentTrialIndex];
    readingChunksRef.current = [];

    const { recorder, mimeType, ext } = createRecorder();
    const stimOnsetMs = performance.now();

    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        readingChunksRef.current.push(event.data);
      }
    };

    const prefix = mode === 'practice' ? 'practice' : 'trial';
    const filename = `${prefix}_${String(currentTrialIndex + 1).padStart(3, '0')}_reading.${ext}`;

    recorder.onstop = () => {
      const stopMs = performance.now();
      const blob = new Blob(readingChunksRef.current, { type: mimeType });
      setTempReading((prev) => prev ? { ...prev, recordStopMs: stopMs, audioBlob: blob } : prev);
      setTempMeaning(null);
      setIsMeaningRecording(false);
      setPhase('meaningRecording');
    };

    recorder.start(250);
    setTempReading({
      trialIndex: currentTrialIndex + 1,
      stimulus,
      stimOnsetMs,
      recordStartMs: stimOnsetMs,
      audioMime: mimeType,
      audioExt: ext,
      audioFile: filename,
    });
    setPhase('recording');
  }

  function stopReadingRecording_V2() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.stop();
  }

  function startMeaningRecording_V2() {
    meaningChunksRef.current = [];
    const { recorder, mimeType, ext } = createRecorder();
    const prefix = mode === 'practice' ? 'practice' : 'trial';
    const filename = `${prefix}_${String(currentTrialIndex + 1).padStart(3, '0')}_meaning.${ext}`;

    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        meaningChunksRef.current.push(event.data);
      }
    };

    const startMs = performance.now();
    recorder.onstop = () => {
      const stopMs = performance.now();
      const blob = new Blob(meaningChunksRef.current, { type: mimeType });
      setTempMeaning((prev) => prev ? { ...prev, stopMs, audioBlob: blob } : prev);
      setIsMeaningRecording(false);
      setPhase('survey');
    };

    setTempMeaning({
      startMs,
      audioMime: mimeType,
      audioExt: ext,
      audioFile: filename,
    });
    setIsMeaningRecording(true);
    recorder.start(250);
  }

  function stopMeaningRecording_V2() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.stop();
  }
  // -------------------------------------------------------------

  function submitSurvey(response: SurveyResponse) {
    if (!tempReading?.audioBlob || tempReading.recordStopMs == null) {
      alert('読み上げ音声データが不完全です。');
      return;
    }

    if (!tempMeaning?.audioBlob || tempMeaning.startMs == null || tempMeaning.stopMs == null) {
      alert('Q1 の口述回答を録音してください。');
      return;
    }

    const result: TrialResult = {
      mode,
      trialIndex: tempReading.trialIndex,
      stimulusId: tempReading.stimulus.id,
      stimulusText: tempReading.stimulus.text,
      length: tempReading.stimulus.text.length,
      stimOnsetMs: tempReading.stimOnsetMs,
      recordStartMs: tempReading.recordStartMs,
      recordStopMs: tempReading.recordStopMs,
      rtKeyMs: tempReading.recordStopMs - tempReading.stimOnsetMs,
      audioMime: tempReading.audioMime || 'audio/webm',
      audioExt: tempReading.audioExt || 'webm',
      audioFile: tempReading.audioFile || 'recording.webm',
      audioBlob: tempReading.audioBlob,
      meaningRecordStartMs: tempMeaning.startMs,
      meaningRecordStopMs: tempMeaning.stopMs,
      meaningRtMs: tempMeaning.stopMs - tempMeaning.startMs,
      meaningAudioMime: tempMeaning.audioMime || 'audio/webm',
      meaningAudioExt: tempMeaning.audioExt || 'webm',
      meaningAudioFile: tempMeaning.audioFile || 'meaning.webm',
      meaningAudioBlob: tempMeaning.audioBlob,
      responses: response,
    };

    setTempReading(null);
    setTempMeaning(null);
    setIsMeaningRecording(false);

    if (mode === 'practice') {
      setPracticeResults((prev) => [...prev, result]);
      const isLast = currentTrialIndex >= orderedPracticeStimuli.length - 1;
      if (isLast) {
        setPhase('intermission');
      } else {
        setCurrentTrialIndex((prev) => prev + 1);
        setCountdown(3);
        setPhase('countdown');
      }
    } else {
      setMainResults((prev) => [...prev, result]);
      const isLast = currentTrialIndex >= orderedMainStimuli.length - 1;
      if (isLast) {
        setMeta((prev) => (prev ? { ...prev, endTimeIso: new Date().toISOString() } : prev));
        setPhase('done');
      } else {
        setCurrentTrialIndex((prev) => prev + 1);
        setCountdown(3);
        setPhase('countdown');
      }
    }
  }

  function exportResultsJson() {
    if (!meta) return;
    const formatTrials = (trials: TrialResult[]) => trials.map((r) => ({
      mode: r.mode,
      trialIndex: r.trialIndex,
      stimulusId: r.stimulusId,
      stimulusText: r.stimulusText,
      length: r.length,
      rtKeyMs: r.rtKeyMs,
      audioFile: r.audioFile,
      meaningRtMs: r.meaningRtMs,
      meaningAudioFile: r.meaningAudioFile,
      responses: r.responses,
    }));

    const exportable = {
      meta,
      practiceTrials: formatTrials(practiceResults),
      mainTrials: formatTrials(mainResults),
    };

    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${meta.subjectId || 'subject'}_results.json`);
  }

  function exportAllAudio() {
    const allResults = [...practiceResults, ...mainResults];
    allResults.forEach((r) => {
      downloadBlob(r.audioBlob, r.audioFile);
      downloadBlob(r.meaningAudioBlob, r.meaningAudioFile);
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300">
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">

        {/* TopBar 只有在非 setup 且非说明页面显示 */}
        {phase !== 'setup' && phase !== 'instructions' && phase !== 'intermission' && (
          <TopBar
            subjectId={subjectId}
            phase={phase}
            mode={mode}
            currentTrialIndex={currentTrialIndex}
            totalTrials={activeStimuli.length}
            progressPercent={progressPercent}
          />
        )}

        <main className="flex flex-1 items-center justify-center py-6">

          {phase === 'setup' && (
            <CardShell className="max-w-3xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>単語読み上げ予備実験
                  </Badge>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">実験の準備</h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                    被験者情報を入力し、マイク権限を許可してから実験を開始します。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <label className="mb-2 block text-sm font-medium text-slate-700">Subject ID</label>
                    <input
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      placeholder="例: S001"
                    />

                    {audioDevices.length > 0 && (
                      <div className="mt-5">
                        <label className="mb-2 block text-sm font-medium text-slate-700">マイクを選択</label>
                        <select
                          className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                          value={selectedDeviceId}
                          onChange={(e) => switchMicrophone(e.target.value)}
                        >
                          {audioDevices.map((device, index) => (
                            <option key={device.deviceId || index} value={device.deviceId}>
                              {device.label || `Microphone ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap gap-3">
                      <PrimaryButton onClick={startExperiment}>次へ（説明を読む）</PrimaryButton>
                      <SecondaryButton onClick={requestMic}>マイク権限を許可</SecondaryButton>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="space-y-4 text-sm">
                      <StatusRow label="マイク状態" value={streamReady ? '準備完了' : '未許可'} success={streamReady} />
                      <StatusRow label="録音形式" value={pickBestAudioMimeType().mimeType || 'browser default'} />
                      {permissionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
                          {permissionError}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700">
                          実験前にブラウザのマイク権限が有効か確認してください。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'instructions' && (
            <CardShell className="max-w-3xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Instructions</Badge>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900">実験の進め方</h2>
                  <p className="text-sm leading-7 text-slate-600">
                    本実験では、画面に表示される単語を声に出して読み、その後その言葉の意味を説明していただきます。
                  </p>
                </div>

                <div className="space-y-4">
                  <InstructionStep
                    number="1"
                    title="単語の読み上げ"
                    desc="カウントダウン後、画面に単語が表示されます。できるだけ自然な速度で声に出して読んでください。読み終わったら、すぐに Space キーを押してください。"
                  />
                  <InstructionStep
                    number="2"
                    title="意味の口述"
                    desc="次に、その単語の意味を口頭で説明していただきます。「録音開始」ボタンを押し、知っている範囲で説明してください。話し終わったら終了ボタンを押します。"
                  />
                  <InstructionStep
                    number="3"
                    title="アンケート回答"
                    desc="最後に、その単語に対する「なじみ度」などを5段階で評価し、次の単語へ進みます。"
                  />
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-800">
                  <p className="font-semibold mb-1">まずは練習から始めましょう</p>
                  <p>操作に慣れていただくため、{PRACTICE_STIMULI.length}回の練習試次を用意しています。準備ができたら下のボタンを押してください。</p>
                </div>

                <div className="flex justify-end">
                  <PrimaryButton onClick={beginPractice}>練習を開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'countdown' && (
            <CardShell className="max-w-2xl text-center">
              <div className="space-y-8">
                <Badge>{mode === 'practice' ? '練習' : '本番'} Trial {currentTrialIndex + 1} / {activeStimuli.length}</Badge>
                <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-8xl font-semibold text-sky-600 shadow-xl shadow-sky-100">
                  {countdown}
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-slate-900">まもなく単語が表示されます</h2>
                  <p className="text-sm leading-7 text-slate-600">
                    表示されたら読み上げ、読み終わったら Space キーを押してください。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'recording' && (
            <CardShell className="max-w-4xl text-center">
              <div className="space-y-10">
                <div className="space-y-3">
                  <Badge>Reading Recording</Badge>
                  <div className="text-sm text-slate-500">{mode === 'practice' ? '練習' : '本番'} Trial {currentTrialIndex + 1} / {activeStimuli.length}</div>
                </div>

                <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-10 shadow-xl shadow-slate-200/50">
                  {/* <div className="mx-auto mb-6 flex h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)]" /> */}
                  <div className="break-words text-4xl font-semibold tracking-[0.08em] text-slate-900 sm:text-6xl">
                    {currentStimulus.text}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xl font-medium text-slate-900">読み上げてください</p>
                  <p className="text-sm leading-7 text-slate-600">
                    読み終わったら <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-700 border border-slate-200">Space</span> キー、または下のボタンを押してください。
                  </p>
                </div>

                <div className="flex justify-center">
                  <PrimaryButton onClick={stopReadingRecording_V2}>次へ進む</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'meaningRecording' && (
            <CardShell className="max-w-4xl">
              <div className="space-y-8 text-center">
                <div className="space-y-3">
                  <Badge>Meaning Recording</Badge>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900">単語の意味を口頭で答えてください</h2>
                  <p className="text-sm leading-7 text-slate-600">
                    対象語: <span className="font-semibold text-slate-900">{currentStimulus.text}</span>
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm leading-7 text-slate-600">
                    わかる範囲で説明してください。録音を開始して話し終わったら、Space キーまたは終了ボタンを押してください。
                  </p>

                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <PrimaryButton onClick={startMeaningRecording_V2} disabled={isMeaningRecording}>
                      {isMeaningRecording ? '録音中...' : '口述回答を開始'}
                    </PrimaryButton>
                    <SecondaryButton onClick={stopMeaningRecording_V2} disabled={!isMeaningRecording}>
                      終了
                    </SecondaryButton>
                  </div>

                  <div className="mt-4 text-sm text-slate-500">
                    {tempMeaning?.audioBlob ? '口述回答が保存されました。' : isMeaningRecording ? '録音中です…' : 'まだ録音されていません。'}
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'survey' && (
            <SurveyForm stimulus={currentStimulus.text} onSubmit={submitSurvey} />
          )}

          {phase === 'intermission' && (
            <CardShell className="max-w-2xl text-center">
              <div className="space-y-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
                  🎉
                </div>
                <div className="space-y-3">
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900">練習が完了しました</h2>
                  <p className="text-sm leading-7 text-slate-600">
                    実験の流れは掴めましたでしょうか？<br />
                    ここから本番（全 {MAIN_STIMULI.length} 試次）が始まります。準備ができたら開始ボタンを押してください。
                  </p>
                </div>
                <div className="flex justify-center pt-4">
                  <PrimaryButton onClick={beginMainExperiment}>本番を開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'done' && (
            <CardShell className="max-w-3xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Completed</Badge>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900">実験完了</h2>
                  <p className="text-sm leading-7 text-slate-600">
                    すべての trial が保存されました。ご協力ありがとうございました。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoCard label="保存済み 本番データ" value={`${mainResults.length} 件`} />
                  <InfoCard label="Subject ID" value={meta?.subjectId || '-'} />
                </div>

                <div className="flex flex-wrap gap-3">
                  <PrimaryButton onClick={exportResultsJson}>results.json をダウンロード</PrimaryButton>
                  <SecondaryButton onClick={exportAllAudio}>すべての音声をダウンロード</SecondaryButton>
                </div>
              </div>
            </CardShell>
          )}
        </main>
      </div>
    </div>
  );
}

// ---- Sub Components ----

function InstructionStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
        {number}
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
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
  const [familiarity, setFamiliarity] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [exposureFreq, setExposureFreq] = useState<number | null>(null);
  const [useFreq, setUseFreq] = useState<number | null>(null);

  function submit() {
    if (familiarity == null || confidence == null || exposureFreq == null || useFreq == null) {
      alert('Q1〜Q4 をすべて選択してください。');
      return;
    }
    onSubmit({ familiarity, confidence, exposureFreq, useFreq });
  }

  return (
    <CardShell className="max-w-4xl">
      <div className="space-y-8">
        <div className="space-y-3">
          <Badge>Post-trial Survey</Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">事後質問</h2>
          <p className="text-sm leading-7 text-slate-600">
            対象語: <span className="font-semibold text-slate-900">{stimulus}</span>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <LikertQuestion label="Q1. なじみ度" value={familiarity} onChange={setFamiliarity} />
          <LikertQuestion label="Q2. 意味理解自信度" value={confidence} onChange={setConfidence} />
          <LikertQuestion label="Q3. 普段の見聞き頻度" value={exposureFreq} onChange={setExposureFreq} />
          <LikertQuestion label="Q4. 自分で使う頻度" value={useFreq} onChange={setUseFreq} />
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
  mode,
  currentTrialIndex,
  totalTrials,
  progressPercent,
}: {
  subjectId: string;
  phase: Phase;
  mode: ExperimentMode;
  currentTrialIndex: number;
  totalTrials: number;
  progressPercent: number;
}) {
  const modeLabel = mode === 'practice' ? '練習モード' : '本番モード';

  return (
    <header className="sticky top-0 z-10 mb-4">
      <div className="rounded-[1.75rem] border border-slate-200 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-xl sm:px-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Experiment Panel - {modeLabel}</div>
            <div className="mt-1 text-sm font-medium text-slate-700">
              {subjectId ? `Subject: ${subjectId}` : 'Subject ID not set'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MiniPill label="Phase" value={phase} />
            <MiniPill label="Trial" value={`${Math.min(currentTrialIndex + 1, totalTrials)}/${totalTrials}`} />
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${mode === 'practice'
              ? 'bg-gradient-to-r from-amber-300 to-orange-400'
              : 'bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-400'
              }`}
            style={{ width: `${Math.max(progressPercent, 5)}%` }}
          />
        </div>
      </div>
    </header>
  );
}

function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`w-full rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl sm:p-8 ${className}`}
    >
      {children}
    </section>
  );
}

function PrimaryButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium transition ${disabled
        ? 'cursor-not-allowed bg-slate-100 text-slate-400'
        : 'bg-slate-900 text-white shadow-md hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg active:translate-y-0'
        }`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-2xl border px-5 py-3 text-sm font-medium transition ${disabled
        ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
        : 'border-slate-300 bg-white text-slate-700 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm active:translate-y-0'
        }`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
      {children}
    </div>
  );
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function StatusRow({ label, value, success = false }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${success ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function LikertQuestion({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number) => void }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 text-sm font-semibold text-slate-800">{label}</div>
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {likertOptions().map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`rounded-2xl border px-0 py-3 text-sm font-medium transition ${value === n
              ? 'border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-200'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-xs font-medium text-slate-400">
        <span>低い</span>
        <span>高い</span>
      </div>
    </section>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="absolute right-0 top-40 h-96 w-96 rounded-full bg-cyan-200/30 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
    </div>
  );
}

export default App;