import React, { useEffect, useMemo, useRef, useState } from 'react';
import illustrationStep1 from './assets/illustration_step1.png';
import illustrationStep2 from './assets/illustration_step2.png';
import illustrationStep3 from './assets/illustration_step3.png';

/**
 * Katakana Reading Experiment MVP (Light Theme + Instructions + Practice)
 * Flow:
 * setup -> consent -> instructions -> practice confirmation -> practice -> main confirmation -> main -> background survey -> done
 * Loop: ready -> countdown -> recording(read aloud) -> meaningRecording(oral meaning) -> survey(likert)
 */

type Phase =
  | 'setup'
  | 'consent'
  | 'instructions'
  | 'practiceConfirmation'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'meaningRecording'
  | 'survey'
  | 'intermission'
  | 'backgroundSurvey'
  | 'done';

type ExperimentMode = 'practice' | 'main';
type StimulusScript = 'hiragana' | 'katakana' | 'mixed' | 'unknown';
type PracticeType = 'normal' | 'none';
type InstructionReturnTarget = 'practice' | 'main' | null;

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

type BackgroundSurveyResponse = {
  japaneseNative: 'yes' | 'no';
  japaneseLearningPeriod: string;
  japaneseCertification: string;
  englishProficiency: string;
  otherLanguages: string;
};

type TrialResult = {
  mode: ExperimentMode;
  practiceType: PracticeType;
  trialIndex: number;
  stimulusId: string;
  stimulusText: string;
  stimulusScript: StimulusScript;
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
  consent: {
    participation: true;
    audioRecording: true;
    consentTimeIso: string;
  };
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

type ZipFileInput = {
  filename: string;
  blob: Blob;
};

// practice stimuli
const PRACTICE_STIMULI: StimulusItem[] = [
  { id: 'p001', text: 'パソコン' },
  { id: 'p002', text: 'てれび' },
  { id: 'p003', text: 'ラジオ' },
];

// formal stimuli
const MAIN_STIMULI: StimulusItem[] = [
  { id: 'w001', text: 'ラスト' },
  // { id: 'w002', text: 'こもの' },
  // { id: 'w003', text: 'フロア' },
  // { id: 'w004', text: 'たから' },
  // { id: 'w005', text: 'ガイドライン' },
  // { id: 'w006', text: 'おおよろこび' },
  // { id: 'w007', text: 'クリーニング' },
  // { id: 'w008', text: 'おさななじみ' },
  // { id: 'w009', text: 'スーパーマーケット' },
  // { id: 'w010', text: 'のうりんぎょぎょう' },
  // { id: 'w011', text: 'リハビリテーション' },
  // { id: 'w012', text: 'にゅうしゅつりょく' },
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

function getStimulusScript(text: string): StimulusScript {
  const hasHiragana = /[\u3041-\u3096]/.test(text);
  const hasKatakana = /[\u30a1-\u30fa\u30fd-\u30ff]/.test(text);

  if (hasHiragana && hasKatakana) return 'mixed';
  if (hasHiragana) return 'hiragana';
  if (hasKatakana) return 'katakana';
  return 'unknown';
}

function getPracticeType(mode: ExperimentMode, trialIndex: number): PracticeType {
  void trialIndex;
  if (mode !== 'practice') return 'none';
  return 'normal';
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

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function calculateCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number) {
  output.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function getDosDateTime(date: Date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosDate, dosTime };
}

function formatLocalTimestampForFilename(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function sanitizeFilenamePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'subject';
}

async function createZipBlob(files: ZipFileInput[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosDate, dosTime } = getDosDateTime(now);
  const chunks: BlobPart[] = [];
  const centralDirectory: number[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBytes = encoder.encode(file.filename);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc32 = calculateCrc32(data);
    const localHeader: number[] = [];

    writeUint32(localHeader, 0x04034b50);
    writeUint16(localHeader, 20);
    writeUint16(localHeader, 0x0800);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, dosTime);
    writeUint16(localHeader, dosDate);
    writeUint32(localHeader, crc32);
    writeUint32(localHeader, data.byteLength);
    writeUint32(localHeader, data.byteLength);
    writeUint16(localHeader, filenameBytes.byteLength);
    writeUint16(localHeader, 0);

    chunks.push(new Uint8Array(localHeader), filenameBytes, data);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, dosTime);
    writeUint16(centralDirectory, dosDate);
    writeUint32(centralDirectory, crc32);
    writeUint32(centralDirectory, data.byteLength);
    writeUint32(centralDirectory, data.byteLength);
    writeUint16(centralDirectory, filenameBytes.byteLength);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, offset);
    centralDirectory.push(...filenameBytes);

    offset += localHeader.length + filenameBytes.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBytes = new Uint8Array(centralDirectory);
  chunks.push(centralDirectoryBytes);
  offset += centralDirectoryBytes.byteLength;

  const endRecord: number[] = [];
  writeUint32(endRecord, 0x06054b50);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, files.length);
  writeUint16(endRecord, files.length);
  writeUint32(endRecord, centralDirectoryBytes.byteLength);
  writeUint32(endRecord, centralDirectoryOffset);
  writeUint16(endRecord, 0);
  chunks.push(new Uint8Array(endRecord));

  return new Blob(chunks, { type: 'application/zip' });
}

function likertOptions() {
  return [1, 2, 3, 4, 5];
}

function getStimulusTextSizeClass(text: string) {
  const length = text.length;

  if (length <= 4) return 'text-6xl sm:text-8xl lg:text-9xl';
  if (length <= 7) return 'text-5xl sm:text-7xl lg:text-8xl';
  if (length <= 10) return 'text-5xl sm:text-6xl lg:text-7xl';
  return 'text-4xl sm:text-5xl lg:text-6xl';
}

type SurveyQuestion = {
  key: keyof SurveyResponse;
  prompt: (stimulus: string) => string;
  lowLabel: string;
  highLabel: string;
};

type InstructionVisualType = 'reading' | 'meaning' | 'rating' | 'practice';

type InstructionPage = {
  badge: string;
  title: string;
  body: string;
  note?: string;
  warning?: string;
  visual: InstructionVisualType;
};

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    key: 'familiarity',
    prompt: (stimulus) => `「${stimulus}」という単語について、見覚えや聞き覚えはどのくらい\nありますか`,
    lowLabel: 'まったく見覚えがない',
    highLabel: 'よく知っている単語だと感じる',
  },
  {
    key: 'confidence',
    prompt: (stimulus) => `「${stimulus}」という単語の意味の説明や例文作成に、どのくらい自信がありますか`,
    lowLabel: 'まったく自信がない',
    highLabel: 'とても自信がある',
  },
  {
    key: 'exposureFreq',
    prompt: (stimulus) => `普段、会話・授業・メディア・インターネットなどで\n「${stimulus}」という単語をどのくらい見たり聞いたりしますか`,
    lowLabel: 'ほとんどない',
    highLabel: 'とてもよくある',
  },
  {
    key: 'useFreq',
    prompt: (stimulus) => `普段、話す・書く・入力する場面で、「${stimulus}」という単語を\nどのくらい使いますか`,
    lowLabel: 'ほとんど使わない',
    highLabel: 'とてもよく使う',
  },
];

const OTHER_LANGUAGE_OPTIONS = [
  '中国語',
  '韓国語',
  'フランス語',
  'オランダ語',
  'ドイツ語',
  'スペイン語',
  'ポルトガル語',
  'その他',
];

const INSTRUCTION_PAGES: InstructionPage[] = [
  {
    badge: 'Step 1',
    title: '単語を声に出して読みます',
    body: '単語が表示されたら、自然な速さで続けて読んでください。読み終わったら、すぐに Space キーを押します。',
    warning: '単語の読み上げの声は録音されます。',
    visual: 'reading',
  },
  {
    badge: 'Step 2',
    title: '意味や例文を声で答えます',
    body: '同じ単語について、意味を説明するか、この単語を使った文を作ってください。答え終わったら Space キーを押します。',
    warning: '意味や例文を答える声は録音されます。',
    visual: 'meaning',
  },
  {
    badge: 'Step 3',
    title: 'アンケートで5段階評価に回答します',
    body: 'アンケートは1問ずつ表示されます。1〜5 の数字を選ぶと、次の質問に進みます。',
    visual: 'rating',
  },
  {
    badge: 'Practice',
    title: 'まずは練習から始めます',
    body: '本番の前に、同じ流れで3回練習します。操作に慣れてから本番に進みます。',
    visual: 'practice',
  },
];

function App() {
  const orderedMainStimuli = useMemo(() => shuffle(MAIN_STIMULI), []);
  const orderedPracticeStimuli = useMemo(() => PRACTICE_STIMULI, []); // 练习通常不打乱

  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<ExperimentMode>('practice');
  const [subjectId, setSubjectId] = useState('');
  const [participationConsent, setParticipationConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [withdrawalConsent, setWithdrawalConsent] = useState(false);
  const [instructionPageIndex, setInstructionPageIndex] = useState(0);
  const [instructionReturnTarget, setInstructionReturnTarget] = useState<InstructionReturnTarget>(null);

  const [streamReady, setStreamReady] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const [currentTrialIndex, setCurrentTrialIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);

  const [practiceResults, setPracticeResults] = useState<TrialResult[]>([]);
  const [mainResults, setMainResults] = useState<TrialResult[]>([]);
  const [backgroundSurvey, setBackgroundSurvey] = useState<BackgroundSurveyResponse | null>(null);
  const [meta, setMeta] = useState<ExperimentMeta | null>(null);

  const [tempReading, setTempReading] = useState<TempReadingRecording | null>(null);
  const [tempMeaning, setTempMeaning] = useState<TempMeaningRecording | null>(null);
  const [isMeaningRecording, setIsMeaningRecording] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const meaningAutoStartKeyRef = useRef('');

  const activeStimuli = mode === 'practice' ? orderedPracticeStimuli : orderedMainStimuli;
  const currentStimulus = activeStimuli[currentTrialIndex];

  const currentResults = mode === 'practice' ? practiceResults : mainResults;
  const completedTrials = currentResults.length;
  const progressPercent = Math.min((completedTrials / activeStimuli.length) * 100, 100);

  async function requestMic() {
    try {
      setPermissionError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('MediaDevices API is not available');
      }
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

  useEffect(() => {
    requestMic();
  }, []);

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
      alert('マイク状態を確認してください。必要に応じて再確認ボタンを押してください。');
      return;
    }

    setParticipationConsent(false);
    setRecordingConsent(false);
    setWithdrawalConsent(false);
    setPhase('consent');
  }

  function beginInstructionsAfterConsent() {
    if (!participationConsent || !recordingConsent || !withdrawalConsent) {
      alert('同意確認の項目をすべて確認してください。');
      return;
    }

    const chosen = pickBestAudioMimeType();
    const now = new Date().toISOString();
    setMeta({
      subjectId: subjectId.trim(),
      startTimeIso: now,
      consent: {
        participation: true,
        audioRecording: true,
        consentTimeIso: now,
      },
      audioMimeChosen: chosen.mimeType,
      mainStimulusOrder: orderedMainStimuli.map((s) => s.id),
      practiceStimulusOrder: orderedPracticeStimuli.map((s) => s.id),
      browser: getBrowserLabel(),
    });

    // 进入说明环节
    setInstructionReturnTarget(null);
    setInstructionPageIndex(0);
    setPhase('instructions');
  }

  function beginPractice() {
    setInstructionReturnTarget(null);
    setMode('practice');
    setCurrentTrialIndex(0);
    setPracticeResults([]);
    setCountdown(3);
    setPhase('ready');
  }

  function repeatFinalPracticeTrial() {
    setInstructionReturnTarget(null);
    setMode('practice');
    setCurrentTrialIndex(Math.max(orderedPracticeStimuli.length - 1, 0));
    setCountdown(3);
    setPhase('ready');
  }

  function beginMainExperiment() {
    setInstructionReturnTarget(null);
    setMode('main');
    setCurrentTrialIndex(0);
    setMainResults([]);
    setCountdown(3);
    setPhase('ready');
  }

  function completeInstructionPages() {
    if (instructionReturnTarget === 'main') {
      setInstructionReturnTarget(null);
      setPhase('intermission');
      return;
    }

    setInstructionReturnTarget(null);
    setPhase('practiceConfirmation');
  }

  function reviewInstructions(target: Exclude<InstructionReturnTarget, null>) {
    setInstructionReturnTarget(target);
    setInstructionPageIndex(0);
    setPhase('instructions');
  }

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

  useEffect(() => {
    if (phase !== 'countdown') return;

    const timer = window.setTimeout(() => {
      if (countdown <= 1) {
        beginReadingRecording_V2();
        return;
      }

      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [phase, countdown, beginReadingRecording_V2]);

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
    if (phase !== 'meaningRecording' || isMeaningRecording || tempMeaning?.audioBlob) return;

    const trialKey = `${mode}-${currentTrialIndex}`;
    if (meaningAutoStartKeyRef.current === trialKey) return;

    const timer = window.setTimeout(() => {
      meaningAutoStartKeyRef.current = trialKey;
      startMeaningRecording_V2();
    }, 150);

    return () => window.clearTimeout(timer);
  }, [phase, mode, currentTrialIndex, isMeaningRecording, tempMeaning?.audioBlob, startMeaningRecording_V2]);

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

  function submitSurvey(response: SurveyResponse) {
    if (!tempReading?.audioBlob || tempReading.recordStopMs == null) {
      alert('読み上げ音声データが不完全です。');
      return;
    }

    if (!tempMeaning?.audioBlob || tempMeaning.startMs == null || tempMeaning.stopMs == null) {
      alert('音声回答の録音が完了していません。');
      return;
    }

    const result: TrialResult = {
      mode,
      practiceType: getPracticeType(mode, currentTrialIndex),
      trialIndex: tempReading.trialIndex,
      stimulusId: tempReading.stimulus.id,
      stimulusText: tempReading.stimulus.text,
      stimulusScript: getStimulusScript(tempReading.stimulus.text),
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
        setPhase('ready');
      }
    } else {
      setMainResults((prev) => [...prev, result]);
      const isLast = currentTrialIndex >= orderedMainStimuli.length - 1;
      if (isLast) {
        setPhase('backgroundSurvey');
      } else {
        setCurrentTrialIndex((prev) => prev + 1);
        setCountdown(3);
        setPhase('ready');
      }
    }
  }

  function startCurrentTrial() {
    setTempReading(null);
    setTempMeaning(null);
    setIsMeaningRecording(false);
    meaningAutoStartKeyRef.current = '';
    setCountdown(3);
    setPhase('countdown');
  }

  function submitBackgroundSurvey(response: BackgroundSurveyResponse) {
    setBackgroundSurvey(response);
    setMeta((prev) => (prev ? { ...prev, endTimeIso: new Date().toISOString() } : prev));
    setPhase('done');
  }

  function createResultsJsonBlob() {
    if (!meta) return null;
    const formatTrials = (trials: TrialResult[]) => trials.map((r) => ({
      mode: r.mode,
      practiceType: r.practiceType,
      trialIndex: r.trialIndex,
      stimulusId: r.stimulusId,
      stimulusText: r.stimulusText,
      stimulusScript: r.stimulusScript,
      length: r.length,
      rtKeyMs: r.rtKeyMs,
      audioFile: r.audioFile,
      meaningRtMs: r.meaningRtMs,
      meaningAudioFile: r.meaningAudioFile,
      responses: r.responses,
    }));

    const exportable = {
      meta,
      backgroundSurvey,
      practiceTrials: formatTrials(practiceResults),
      mainTrials: formatTrials(mainResults),
    };

    return new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
  }

  function createResultsCsvBlob() {
    if (!meta) return null;
    const escapeCsvCell = (value: string | number | undefined) => {
      const text = value == null ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    const headers = [
      'subjectId',
      'mode',
      'practiceType',
      'trialIndex',
      'stimulusId',
      'stimulusText',
      'stimulusScript',
      'length',
      'rtKeyMs',
      'meaningRtMs',
      'familiarity',
      'confidence',
      'exposureFreq',
      'useFreq',
      'audioFile',
      'meaningAudioFile',
    ];
    const allResults = [...practiceResults, ...mainResults];
    const rows = allResults.map((r) => [
      meta.subjectId,
      r.mode,
      r.practiceType,
      r.trialIndex,
      r.stimulusId,
      r.stimulusText,
      r.stimulusScript,
      r.length,
      Math.round(r.rtKeyMs),
      Math.round(r.meaningRtMs),
      r.responses.familiarity,
      r.responses.confidence,
      r.responses.exposureFreq,
      r.responses.useFreq,
      r.audioFile,
      r.meaningAudioFile,
    ]);
    const csv = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => row.map(escapeCsvCell).join(',')),
    ].join('\n');

    return new Blob([`\uFEFF${csv}\n`], { type: 'text/csv;charset=utf-8' });
  }

  function createBackgroundSurveyCsvBlob() {
    if (!meta || !backgroundSurvey) return null;
    const escapeCsvCell = (value: string | number | undefined) => {
      const text = value == null ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    const headers = [
      'subjectId',
      'japaneseNative',
      'japaneseLearningPeriod',
      'japaneseCertification',
      'englishProficiency',
      'otherLanguages',
    ];
    const row = [
      meta.subjectId,
      backgroundSurvey.japaneseNative,
      backgroundSurvey.japaneseLearningPeriod,
      backgroundSurvey.japaneseCertification,
      backgroundSurvey.englishProficiency,
      backgroundSurvey.otherLanguages,
    ];
    const csv = [
      headers.map(escapeCsvCell).join(','),
      row.map(escapeCsvCell).join(','),
    ].join('\n');

    return new Blob([`\uFEFF${csv}\n`], { type: 'text/csv;charset=utf-8' });
  }

  function exportResultsJson() {
    if (!meta) return;
    const blob = createResultsJsonBlob();
    if (!blob) return;
    downloadBlob(blob, `${meta.subjectId || 'subject'}_results.json`);
  }

  function exportResultsCsv() {
    if (!meta) return;
    const blob = createResultsCsvBlob();
    if (!blob) return;
    downloadBlob(blob, `${meta.subjectId || 'subject'}_trials.csv`);

    const backgroundBlob = createBackgroundSurveyCsvBlob();
    if (backgroundBlob) {
      downloadBlob(backgroundBlob, `${meta.subjectId || 'subject'}_background_survey.csv`);
    }
  }

  function exportAllAudio() {
    const allResults = [...practiceResults, ...mainResults];
    allResults.forEach((r) => {
      downloadBlob(r.audioBlob, r.audioFile);
      downloadBlob(r.meaningAudioBlob, r.meaningAudioFile);
    });
  }

  async function exportAllDataZip() {
    if (!meta) return;
    const resultsBlob = createResultsJsonBlob();
    const csvBlob = createResultsCsvBlob();
    const backgroundCsvBlob = createBackgroundSurveyCsvBlob();
    if (!resultsBlob || !csvBlob) return;

    const allResults = [...practiceResults, ...mainResults];
    const files: ZipFileInput[] = [
      {
        filename: `${meta.subjectId || 'subject'}_results.json`,
        blob: resultsBlob,
      },
      {
        filename: `${meta.subjectId || 'subject'}_trials.csv`,
        blob: csvBlob,
      },
      ...(backgroundCsvBlob ? [{
        filename: `${meta.subjectId || 'subject'}_background_survey.csv`,
        blob: backgroundCsvBlob,
      }] : []),
      ...allResults.flatMap((r) => [
        {
          filename: `audio/${r.audioFile}`,
          blob: r.audioBlob,
        },
        {
          filename: `audio/${r.meaningAudioFile}`,
          blob: r.meaningAudioBlob,
        },
      ]),
    ];

    const zipBlob = await createZipBlob(files);
    const subjectLabel = sanitizeFilenamePart(meta.subjectId || 'subject');
    const timestamp = formatLocalTimestampForFilename(new Date());
    downloadBlob(zipBlob, `${subjectLabel}_${timestamp}_experiment_data.zip`);
  }

  const instructionPage = INSTRUCTION_PAGES[instructionPageIndex];
  const isLastInstructionPage = instructionPageIndex === INSTRUCTION_PAGES.length - 1;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300">
      <BackgroundGlow />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">

        {/* TopBar 只有在非 setup 且非说明页面显示 */}
        {phase !== 'setup' && phase !== 'consent' && phase !== 'instructions' && phase !== 'practiceConfirmation' && phase !== 'intermission' && (
          <TopBar
            mode={mode}
            progressPercent={progressPercent}
          />
        )}

        <main className="flex flex-1 items-center justify-center py-4 sm:py-6">

          {phase === 'setup' && (
            <CardShell className="max-w-7xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>単語読み上げ予備実験
                  </Badge>
                  <h1 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">実験の準備</h1>
                  <p className="max-w-7xl text-2xl leading-9 text-slate-600">
                    被験者情報を入力します。マイク権限は自動で確認されます。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <label className="mb-2 block text-2xl font-medium text-slate-700">Subject ID</label>
                    <input
                      className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-2xl text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      placeholder="例: S001"
                    />

                    {audioDevices.length > 0 && (
                      <div className="mt-5">
                        <label className="mb-2 block text-2xl font-medium text-slate-700">マイクを選択</label>
                        <select
                          className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-5 py-4 text-2xl text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
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
                      <PrimaryButton onClick={startExperiment}>同意確認へ進む</PrimaryButton>
                      <SecondaryButton onClick={requestMic}>マイク権限を再確認</SecondaryButton>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="space-y-4 text-2xl">
                      <StatusRow label="マイク状態" value={streamReady ? '準備完了' : '未許可'} success={streamReady} />
                      <StatusRow label="録音形式" value={pickBestAudioMimeType().mimeType || 'browser default'} />
                      {permissionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-2xl leading-9 text-rose-700">
                          {permissionError}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-2xl leading-9 text-emerald-700">
                          ページを開くと、ブラウザがマイク権限を確認します。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'consent' && (
            <CardShell className="max-w-7xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Consent Form</Badge>
                  <h1 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">実験参加と録音の同意確認</h1>
                  <p className="max-w-6xl text-2xl leading-9 text-slate-600">
                    実験の内容と録音について確認し、同意する場合のみ次へ進んでください。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-3xl font-semibold text-slate-900">確認事項</h2>
                    <div className="mt-5 space-y-4 text-2xl leading-9 text-slate-700">
                      <p>
                        この実験では、画面に表示される単語を声に出して読み、そのあと同じ単語について意味の説明または例文を声で答えていただきます。
                      </p>
                      <p>
                        単語の読み上げと、意味や例文を答える声は録音されます。
                      </p>
                      <p>
                        回答データと録音データは、研究目的で保存・分析します。
                      </p>
                    </div>
                    <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-2xl leading-9 text-amber-900">
                      内容を確認し、同意できる場合のみ次へ進んでください。
                    </p>
                  </div>

                  <div className="space-y-4">
                    <ConsentCheck
                      checked={participationConsent}
                      onChange={setParticipationConsent}
                      title="実験参加への同意"
                    >
                      実験の内容を確認し、参加することに同意します。
                    </ConsentCheck>
                    <ConsentCheck
                      checked={recordingConsent}
                      onChange={setRecordingConsent}
                      title="録音への同意"
                    >
                      録音データを、読み上げ方や回答内容の確認・分析に使用することに同意します。個人の声は、SNS、ウェブサイトなどで公開されません。
                    </ConsentCheck>
                    <ConsentCheck
                      checked={withdrawalConsent}
                      onChange={setWithdrawalConsent}
                      title="参加の任意性と同意撤回の確認"
                    >
                      参加は任意であり、参加しない場合や同意を撤回する場合でも不利益はありません。撤回時は可能な範囲で記録とデータを破棄しますが、匿名化後や解析後は個別に破棄できない場合があります。
                    </ConsentCheck>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  <SecondaryButton onClick={() => setPhase('setup')}>戻る</SecondaryButton>
                  <PrimaryButton
                    onClick={beginInstructionsAfterConsent}
                    disabled={!participationConsent || !recordingConsent || !withdrawalConsent}
                  >
                    同意して説明へ進む
                  </PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'instructions' && (
            <CardShell className="max-w-7xl">
              <div className="space-y-10">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <Badge>Instructions</Badge>
                  <div className="text-2xl font-semibold text-slate-500">
                    {instructionPageIndex + 1} / {INSTRUCTION_PAGES.length}
                  </div>
                </div>

                <div className="min-h-[420px] rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10">
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
                    <InstructionIllustration type={instructionPage.visual} />

                    <div className="space-y-8">
                      <div className="inline-flex rounded-full bg-sky-50 px-4 py-2 text-2xl font-semibold text-sky-700">
                        {instructionPage.badge}
                      </div>
                      <div className="space-y-5">
                        <h2 className="text-5xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
                          {instructionPage.title}
                        </h2>
                        <p className="text-3xl leading-10 text-slate-700">
                          {instructionPage.body}
                        </p>
                      </div>
                      {instructionPage.note && (
                        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-2xl leading-9 text-sky-800">
                          {instructionPage.note}
                        </div>
                      )}
                      {instructionPage.warning && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-2xl font-semibold leading-9 text-rose-900">
                          {instructionPage.warning}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3" aria-label="説明ページの進捗">
                  {INSTRUCTION_PAGES.map((page, index) => (
                    <div
                      key={page.badge}
                      className={`h-3 rounded-full transition ${index <= instructionPageIndex ? 'bg-sky-500' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                  <SecondaryButton
                    onClick={() => setInstructionPageIndex((prev) => Math.max(prev - 1, 0))}
                    disabled={instructionPageIndex === 0}
                  >
                    戻る
                  </SecondaryButton>
                  {isLastInstructionPage ? (
                    <PrimaryButton onClick={completeInstructionPages}>
                      確認画面へ進む
                    </PrimaryButton>
                  ) : (
                    <PrimaryButton
                      onClick={() => setInstructionPageIndex((prev) => Math.min(prev + 1, INSTRUCTION_PAGES.length - 1))}
                    >
                      次へ
                    </PrimaryButton>
                  )}
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'practiceConfirmation' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-8">
                <Badge>練習前確認</Badge>
                <div className="space-y-4">
                  <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                    操作方法はわかりましたか
                  </h2>
                  <p className="text-4xl font-medium leading-10 text-slate-700">
                    不明な点があれば、説明をもう一度確認できます。<br />
                    準備ができたら練習を始めてください。
                  </p>
                </div>
                <div className="flex flex-col-reverse justify-center gap-3 pt-4 sm:flex-row">
                  <SecondaryButton onClick={() => reviewInstructions('practice')}>
                    説明をもう一度確認する
                  </SecondaryButton>
                  <PrimaryButton onClick={beginPractice}>練習を開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'ready' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-8">
                <div className="space-y-4">
                  <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                    準備ができたら開始してください
                  </h2>
                  <p className="text-4xl font-medium leading-10 text-slate-700">
                    ボタンを押すとカウントダウンが始まり、そのあと単語が表示されます。
                  </p>
                </div>
                <div className="flex justify-center pt-2">
                  <PrimaryButton onClick={startCurrentTrial}>開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'countdown' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-10">
                <div className="mx-auto flex h-60 w-60 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-9xl font-semibold text-sky-600 shadow-xl shadow-sky-100 sm:h-72 sm:w-72">
                  {countdown}
                </div>
                <div className="space-y-3">
                  <h2 className="text-5xl font-semibold text-slate-900">まもなく単語が表示されます</h2>
                  <p className="text-3xl font-semibold text-slate-600">
                    読む → Space
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'recording' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-12">
                <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-14 shadow-xl shadow-slate-200/50 sm:px-10 sm:py-16">
                  {/* <div className="mx-auto mb-6 flex h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)]" /> */}
                  <div className={`whitespace-nowrap font-semibold leading-none text-slate-900 ${getStimulusTextSizeClass(currentStimulus.text)}`}>
                    {currentStimulus.text}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-5xl font-semibold text-slate-900">読み上げてください</p>
                  <p className="text-4xl font-medium leading-10 text-slate-700">
                    読み終わったら <span className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-slate-800">Space</span> キーを押してください。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'meaningRecording' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-12">
                <div className="rounded-[2rem] border border-sky-200 bg-sky-50 px-6 py-14 shadow-xl shadow-sky-100/70 sm:px-10 sm:py-16">
                  <div className={`whitespace-nowrap font-semibold leading-none text-slate-900 ${getStimulusTextSizeClass(currentStimulus.text)}`}>
                    {currentStimulus.text}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-5xl font-semibold text-slate-900">意味や例文を答えてください</p>
                  <p className="text-4xl font-medium leading-10 text-slate-700">
                    答え終わったら <span className="rounded-xl border border-sky-200 bg-sky-100 px-4 py-2 text-sky-900">Space</span> キーを押してください。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'survey' && (
            <SurveyForm stimulus={currentStimulus.text} onSubmit={submitSurvey} />
          )}

          {phase === 'backgroundSurvey' && (
            <BackgroundSurveyForm onSubmit={submitBackgroundSurvey} />
          )}

          {phase === 'intermission' && (
            <CardShell className="max-w-7xl text-center">
              <div className="space-y-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl">
                  🎉
                </div>
                <div className="space-y-3">
                  <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">操作に慣れましたか</h2>
                  <p className="text-3xl font-medium leading-10 text-slate-700">
                    本番に進む準備ができたら、開始してください。<br />
                    まだ不安がある場合は、最後の練習をもう一度行えます。
                  </p>
                </div>
                <div className="flex flex-col-reverse justify-center gap-3 pt-4 sm:flex-row">
                  <SecondaryButton onClick={repeatFinalPracticeTrial}>
                    最後の練習をもう一度行う
                  </SecondaryButton>
                  <PrimaryButton onClick={beginMainExperiment}>本番を開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'done' && (
            <CardShell className="max-w-7xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Completed</Badge>
                  <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">実験は以上です</h2>
                  <p className="text-4xl font-semibold leading-10 text-slate-900 sm:text-5xl">
                    ご協力いただき、誠にありがとうございました。
                  </p>
                  <p className="text-2xl leading-9 text-slate-600">
                    すべての回答が保存されました。実験者がデータを保存しますので、少々お待ちください。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoCard label="保存済み 本番データ" value={`${mainResults.length} 件`} />
                  <InfoCard label="背景アンケート" value={backgroundSurvey ? '回答済み' : '未回答'} />
                  <InfoCard label="Subject ID" value={meta?.subjectId || '-'} />
                </div>

                <div className="flex flex-wrap gap-3">
                  <PrimaryButton onClick={exportAllDataZip}>データ一式をZIPでダウンロード</PrimaryButton>
                  <SecondaryButton onClick={exportResultsJson}>results.json のみ</SecondaryButton>
                  <SecondaryButton onClick={exportResultsCsv}>CSV のみ</SecondaryButton>
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

function InstructionIllustration({ type }: { type: InstructionVisualType }) {
  const illustrationSrcByType: Partial<Record<InstructionVisualType, string>> = {
    reading: illustrationStep1,
    meaning: illustrationStep2,
    rating: illustrationStep3,
  };
  const illustrationSrc = illustrationSrcByType[type];

  if (type === 'practice') {
    return (
      <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-6 shadow-inner">
        <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
          <div className="grid grid-cols-3 gap-3">
            {['読む', '答える', '選ぶ'].map((label, index) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4 text-center">
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 text-2xl font-semibold text-white">
                  {index + 1}
                </div>
                <div className="text-2xl font-semibold text-slate-800">{label}</div>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-center text-2xl font-semibold leading-8 text-amber-900">
            本番前に練習します
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-72 items-center justify-center overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50"
      data-illustration-slot={type}
    >
      <img
        src={illustrationSrc}
        alt=""
        className="h-full max-h-[360px] w-full object-contain"
        aria-hidden="true"
      />
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
  const [responses, setResponses] = useState<Partial<SurveyResponse>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const advanceTimerRef = useRef<number | null>(null);

  const currentQuestion = SURVEY_QUESTIONS[questionIndex];
  const currentValue = responses[currentQuestion.key] ?? null;
  const isLastQuestion = questionIndex === SURVEY_QUESTIONS.length - 1;

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current != null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, []);

  function selectResponse(value: number) {
    if (isAdvancing) return;

    const nextResponses = {
      ...responses,
      [currentQuestion.key]: value,
    };

    setResponses(nextResponses);
    setIsAdvancing(true);

    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current);
    }

    if (!isLastQuestion) {
      advanceTimerRef.current = window.setTimeout(() => {
        setQuestionIndex((prev) => prev + 1);
        setIsAdvancing(false);
        advanceTimerRef.current = null;
      }, 280);
      return;
    }

    const completed = SURVEY_QUESTIONS.every((question) => nextResponses[question.key] != null);
    if (!completed) {
      setIsAdvancing(false);
      alert('未回答の質問があります。');
      return;
    }

    advanceTimerRef.current = window.setTimeout(() => {
      onSubmit({
        familiarity: nextResponses.familiarity!,
        confidence: nextResponses.confidence!,
        exposureFreq: nextResponses.exposureFreq!,
        useFreq: nextResponses.useFreq!,
      });
      advanceTimerRef.current = null;
    }, 280);
  }

  return (
    <CardShell className="max-w-7xl">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">アンケート</h2>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-2xl font-semibold text-slate-600">
            {questionIndex + 1} / {SURVEY_QUESTIONS.length}
          </div>
        </div>

        <LikertQuestion
          prompt={currentQuestion.prompt(stimulus)}
          lowLabel={currentQuestion.lowLabel}
          highLabel={currentQuestion.highLabel}
          value={currentValue}
          onChange={selectResponse}
          disabled={isAdvancing}
        />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SecondaryButton
            onClick={() => setQuestionIndex((prev) => Math.max(prev - 1, 0))}
            disabled={questionIndex === 0 || isAdvancing}
          >
            戻る
          </SecondaryButton>
          <p className="text-2xl leading-9 text-slate-500">
            {isLastQuestion ? '数字を選ぶと次の単語に進みます。' : '数字を選ぶと次の質問に進みます。'}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

function BackgroundSurveyForm({
  onSubmit,
}: {
  onSubmit: (response: BackgroundSurveyResponse) => void;
}) {
  const [japaneseNative, setJapaneseNative] = useState<BackgroundSurveyResponse['japaneseNative'] | ''>('');
  const [japaneseLearningPeriod, setJapaneseLearningPeriod] = useState('');
  const [japaneseCertification, setJapaneseCertification] = useState('');
  const [englishProficiency, setEnglishProficiency] = useState('');
  const [selectedOtherLanguages, setSelectedOtherLanguages] = useState<string[]>([]);
  const [otherLanguageDetail, setOtherLanguageDetail] = useState('');

  const trimmedLearningPeriod = japaneseLearningPeriod.trim();
  const trimmedCertification = japaneseCertification.trim();
  const trimmedEnglish = englishProficiency.trim();
  const trimmedOtherLanguageDetail = otherLanguageDetail.trim();
  const needsOtherLanguageDetail = selectedOtherLanguages.includes('その他');
  const canSubmit =
    japaneseNative !== '' &&
    (japaneseNative === 'yes' || trimmedLearningPeriod.length > 0) &&
    (japaneseNative === 'yes' || trimmedCertification.length > 0) &&
    trimmedEnglish.length > 0 &&
    (!needsOtherLanguageDetail || trimmedOtherLanguageDetail.length > 0);

  function toggleOtherLanguage(language: string) {
    setSelectedOtherLanguages((prev) => (
      prev.includes(language)
        ? prev.filter((item) => item !== language)
        : [...prev, language]
    ));
  }

  function formatOtherLanguages() {
    const selected = selectedOtherLanguages.filter((language) => language !== 'その他');
    if (needsOtherLanguageDetail) {
      selected.push(`その他: ${trimmedOtherLanguageDetail}`);
    }
    return selected.length > 0 ? selected.join('; ') : 'なし';
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (japaneseNative === '' || !canSubmit) {
      alert('未回答の項目があります。');
      return;
    }

    onSubmit({
      japaneseNative,
      japaneseLearningPeriod: japaneseNative === 'yes' ? '母語' : trimmedLearningPeriod,
      japaneseCertification: japaneseNative === 'yes' ? '母語のため該当なし' : trimmedCertification,
      englishProficiency: trimmedEnglish,
      otherLanguages: formatOtherLanguages(),
    });
  }

  return (
    <CardShell className="max-w-7xl">
      <form className="space-y-8" onSubmit={submit}>
        <div className="space-y-3">
          <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-5xl">背景アンケート</h2>
          <p className="text-2xl leading-9 text-slate-600">
            最後に、言語背景について回答してください。
          </p>
        </div>

        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <fieldset className="space-y-4">
            <legend className="text-3xl font-semibold text-slate-900">日本語は母語ですか</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceButton
                selected={japaneseNative === 'yes'}
                onClick={() => setJapaneseNative('yes')}
              >
                はい
              </ChoiceButton>
              <ChoiceButton
                selected={japaneseNative === 'no'}
                onClick={() => setJapaneseNative('no')}
              >
                いいえ
              </ChoiceButton>
            </div>
          </fieldset>

          {japaneseNative === 'no' && (
            <>
              <LabeledTextInput
                label="日本語の学習期間"
                value={japaneseLearningPeriod}
                onChange={setJapaneseLearningPeriod}
                placeholder="例: 3年、6か月"
              />

              <LabeledTextInput
                label="日本語の資格・試験"
                value={japaneseCertification}
                onChange={setJapaneseCertification}
                placeholder="例: JLPT N1、J.TEST 700点、なし"
              />
            </>
          )}

          <LabeledTextInput
            label="英語能力・試験"
            value={englishProficiency}
            onChange={setEnglishProficiency}
            placeholder="例: TOEIC 800点、TOEFL iBT 90、IELTS 6.5、英検準1級、なし"
          />

          <fieldset className="space-y-4">
            <legend className="text-3xl font-semibold text-slate-900">その他に使用できる言語</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {OTHER_LANGUAGE_OPTIONS.map((language) => (
                <MultiChoiceButton
                  key={language}
                  selected={selectedOtherLanguages.includes(language)}
                  onClick={() => toggleOtherLanguage(language)}
                >
                  {language}
                </MultiChoiceButton>
              ))}
            </div>
          </fieldset>

          {needsOtherLanguageDetail && (
            <LabeledTextInput
              label="その他の言語"
              value={otherLanguageDetail}
              onChange={setOtherLanguageDetail}
              placeholder="例: イタリア語、ベトナム語"
            />
          )}
        </div>

        <div className="flex justify-end">
          <PrimaryButton disabled={!canSubmit} onClick={() => undefined}>
            回答を送信する
          </PrimaryButton>
        </div>
      </form>
    </CardShell>
  );
}

function ChoiceButton({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-16 rounded-2xl border px-6 py-4 text-2xl font-semibold transition ${selected
        ? 'border-sky-500 bg-sky-500 text-white shadow-lg shadow-sky-200'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`}
    >
      {children}
    </button>
  );
}

function ConsentCheck({
  title,
  children,
  checked,
  onChange,
}: {
  title: string;
  children: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-32 cursor-pointer items-center gap-4 rounded-3xl border px-5 py-4 shadow-sm transition ${checked
      ? 'border-sky-300 bg-sky-50'
      : 'border-slate-200 bg-white hover:border-slate-300'
      }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-7 w-7 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      <span className="space-y-1.5">
        <span className="block text-2xl font-semibold text-slate-900">{title}</span>
        <span className="block text-2xl leading-8 text-slate-700">{children}</span>
      </span>
    </label>
  );
}

function MultiChoiceButton({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-center justify-center rounded-2xl border px-4 py-3 text-2xl font-semibold transition ${selected
        ? 'border-sky-500 bg-sky-500 text-white shadow-lg shadow-sky-200'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
        }`}
      aria-pressed={selected}
    >
      {children}
    </button>
  );
}

function LabeledTextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-3xl font-semibold text-slate-900">{label}</span>
      <input
        className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-2xl text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function TopBar({
  mode,
  progressPercent,
}: {
  mode: ExperimentMode;
  progressPercent: number;
}) {
  return (
    <header className="sticky top-0 z-10 mb-4">
      <div className="rounded-full border border-slate-200 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-xl sm:px-6">
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
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
      className={`w-full rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl sm:p-9 ${className}`}
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
      className={`inline-flex min-h-14 items-center justify-center whitespace-nowrap rounded-2xl px-6 py-4 text-2xl font-medium transition ${disabled
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
      className={`inline-flex min-h-14 items-center justify-center whitespace-nowrap rounded-2xl border px-6 py-4 text-2xl font-medium transition ${disabled
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
    <div className="inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-2xl font-semibold uppercase tracking-[0.18em] text-sky-700">
      {children}
    </div>
  );
}

function StatusRow({ label, value, success = false }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`break-all text-right font-semibold ${success ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-2xl font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-4xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function LikertQuestion({
  prompt,
  lowLabel,
  highLabel,
  value,
  onChange,
  disabled = false,
}: {
  prompt: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h3 className="whitespace-pre-line text-4xl font-semibold leading-tight text-slate-900">{prompt}</h3>

      <div className="mt-6 flex items-stretch justify-between gap-4 text-2xl font-semibold text-slate-800">
        <span className="flex min-h-14 max-w-[45%] items-center rounded-2xl bg-slate-100 px-4 py-3 text-left leading-7">{lowLabel}</span>
        <span className="flex min-h-14 max-w-[45%] items-center justify-end rounded-2xl bg-slate-100 px-4 py-3 text-right leading-7">{highLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 sm:gap-3">
        {likertOptions().map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            disabled={disabled}
            className={`min-h-16 rounded-2xl border px-0 py-3 text-3xl font-semibold transition duration-150 ${value === n
              ? 'scale-105 border-sky-500 bg-sky-500 text-white shadow-lg shadow-sky-200'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
          >
            {n}
          </button>
        ))}
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
