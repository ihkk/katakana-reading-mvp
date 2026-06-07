import React, { useEffect, useMemo, useRef, useState } from 'react';
import illustrationStep1 from './assets/illustration_step1.png';
import illustrationStep2 from './assets/illustration_step2.png';
import illustrationStep3 from './assets/illustration_step3.png';

/**
 * Katakana Reading Experiment MVP (Light Theme + Instructions + Practice)
 * Flow:
 * setup -> instructions -> guided practice -> check pause -> normal practice -> intermission -> main -> done
 * Loop: countdown -> recording(read aloud) -> meaningRecording(oral meaning) -> survey(likert)
 */

type Phase =
  | 'setup'
  | 'instructions'
  | 'countdown'
  | 'recording'
  | 'meaningRecording'
  | 'survey'
  | 'guidedPracticeCheck'
  | 'intermission'
  | 'done';

type ExperimentMode = 'practice' | 'main';
type StimulusScript = 'hiragana' | 'katakana' | 'mixed' | 'unknown';
type PracticeType = 'guided' | 'normal' | 'none';
type InstructionReturnTarget = 'guidedPractice';

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
  { id: 'w002', text: 'はしり' },
  { id: 'w003', text: 'フロア' },
  { id: 'w004', text: 'まじる' },
  { id: 'w005', text: 'ガイドライン' },
  { id: 'w006', text: 'まぜあわせる' },
  { id: 'w007', text: 'クリーニング' },
  { id: 'w008', text: 'かんがえこむ' },
  { id: 'w009', text: 'スーパーマーケット' },
  { id: 'w010', text: 'のうりんぎょぎょう' },
  { id: 'w011', text: 'リハビリテーション' },
  { id: 'w012', text: 'すーぱーまーけっと' },
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
  if (mode !== 'practice') return 'none';
  return trialIndex === 0 ? 'guided' : 'normal';
}

function getPhaseDisplayLabel(phase: Phase) {
  const labels: Record<Phase, string> = {
    setup: '準備',
    instructions: '説明',
    countdown: '準備中',
    recording: '読み上げ',
    meaningRecording: '音声回答',
    survey: 'アンケート',
    guidedPracticeCheck: '確認',
    intermission: '本番前',
    done: '完了',
  };

  return labels[phase];
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
  if (length <= 10) return 'text-4xl sm:text-6xl lg:text-7xl';
  return 'text-3xl sm:text-5xl lg:text-6xl';
}

type SurveyQuestion = {
  key: keyof SurveyResponse;
  label: string;
  description: string;
  lowLabel: string;
  highLabel: string;
};

type InstructionVisualType = 'reading' | 'meaning' | 'rating' | 'practice';

type InstructionPage = {
  badge: string;
  title: string;
  body: string;
  note: string;
  visual: InstructionVisualType;
};

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    key: 'familiarity',
    label: 'この単語を見たとき、どのくらい「知っている単語だ」と感じますか',
    description: '単語としての見覚えや聞き覚えの程度を答えてください。',
    lowLabel: 'まったく見覚えがない',
    highLabel: 'よく知っている単語だと感じる',
  },
  {
    key: 'confidence',
    label: 'この単語の意味や例文をどのくらい自信をもって答えられますか',
    description: '意味の説明や、この単語を使った文をどのくらい自信をもって作れるかを答えてください。',
    lowLabel: 'まったく自信がない',
    highLabel: 'とても自信がある',
  },
  {
    key: 'exposureFreq',
    label: '普段、この単語をどのくらい見たり聞いたりしますか',
    description: '会話、授業、メディア、インターネットなどで接する頻度を答えてください。',
    lowLabel: 'ほとんどない',
    highLabel: 'とてもよくある',
  },
  {
    key: 'useFreq',
    label: '普段、自分でこの単語をどのくらい使いますか',
    description: '話す、書く、入力するなど、自分から使う頻度を答えてください。',
    lowLabel: 'ほとんど使わない',
    highLabel: 'とてもよく使う',
  },
];

const INSTRUCTION_PAGES: InstructionPage[] = [
  {
    badge: 'Step 1',
    title: '単語を声に出して読みます',
    body: 'カウントダウンのあと、画面中央に単語が大きく表示されます。表示された単語を、できるだけ自然な速度で声に出して読んでください。',
    note: '読み終わったら、すぐに Space キーを押してください。',
    visual: 'reading',
  },
  {
    badge: 'Step 2',
    title: '意味や例文を声で答えます',
    body: '読み上げが終わると、同じ単語について答える画面に進み、自動で録音が始まります。意味の説明でも、この単語を使った文でもかまいません。',
    note: 'わかる範囲で答えてください。答え終わったら Space キーを押してください。',
    visual: 'meaning',
  },
  {
    badge: 'Step 3',
    title: 'アンケートで5段階評価に回答します',
    body: '読み上げと声に出す回答が終わったあと、単語について表示されるアンケートに答えます。各質問では、1〜5 の数字を選びます。',
    note: '質問は一つずつ表示されます。数字を選ぶと次の質問に進みます。',
    visual: 'rating',
  },
  {
    badge: 'Practice',
    title: 'まずは練習から始めます',
    body: '最初の1回は操作ガイドを見ながら練習します。そのあと一度止まり、操作方法について確認してから、本番と同じ形式の練習に進みます。',
    note: '不明な点があれば、確認の画面で実験者に質問できます。',
    visual: 'practice',
  },
];

function App() {
  const orderedMainStimuli = useMemo(() => shuffle(MAIN_STIMULI), []);
  const orderedPracticeStimuli = useMemo(() => PRACTICE_STIMULI, []); // 练习通常不打乱

  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<ExperimentMode>('practice');
  const [subjectId, setSubjectId] = useState('');
  const [instructionPageIndex, setInstructionPageIndex] = useState(0);
  const [instructionReturnTarget, setInstructionReturnTarget] = useState<InstructionReturnTarget | null>(null);

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
  const meaningAutoStartKeyRef = useRef('');

  const activeStimuli = mode === 'practice' ? orderedPracticeStimuli : orderedMainStimuli;
  const currentStimulus = activeStimuli[currentTrialIndex];
  const isGuidedPracticeTrial = getPracticeType(mode, currentTrialIndex) === 'guided';

  const currentResults = mode === 'practice' ? practiceResults : mainResults;
  const completedTrials = currentResults.length;
  const progressPercent = (completedTrials / activeStimuli.length) * 100;

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
    setInstructionPageIndex(0);
    setInstructionReturnTarget(null);
    setPhase('instructions');
  }

  function beginPractice() {
    setInstructionReturnTarget(null);
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

  function beginNormalPractice() {
    setInstructionReturnTarget(null);
    setCurrentTrialIndex(1);
    setCountdown(3);
    setPhase('countdown');
  }

  function restartGuidedPractice() {
    setInstructionReturnTarget(null);
    setMode('practice');
    setCurrentTrialIndex(0);
    setPracticeResults([]);
    setTempReading(null);
    setTempMeaning(null);
    setIsMeaningRecording(false);
    meaningAutoStartKeyRef.current = '';
    setCountdown(3);
    setPhase('countdown');
  }

  function reviewInstructionsFromPracticeCheck() {
    setInstructionPageIndex(0);
    setInstructionReturnTarget('guidedPractice');
    setPhase('instructions');
  }

  function completeInstructionPages() {
    if (instructionReturnTarget === 'guidedPractice') {
      restartGuidedPractice();
      return;
    }

    beginPractice();
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
      if (getPracticeType(mode, currentTrialIndex) === 'guided') {
        setPhase('guidedPracticeCheck');
        return;
      }

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
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">

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

        <main className="flex flex-1 items-center justify-center py-4 sm:py-6">

          {phase === 'setup' && (
            <CardShell className="max-w-6xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>単語読み上げ予備実験
                  </Badge>
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">実験の準備</h1>
                  <p className="max-w-6xl text-lg leading-8 text-slate-600">
                    被験者情報を入力します。マイク権限は自動で確認されます。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <label className="mb-2 block text-lg font-medium text-slate-700">Subject ID</label>
                    <input
                      className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-4 text-xl text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      placeholder="例: S001"
                    />

                    {audioDevices.length > 0 && (
                      <div className="mt-5">
                        <label className="mb-2 block text-lg font-medium text-slate-700">マイクを選択</label>
                        <select
                          className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-5 py-4 text-lg text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
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
                      <PrimaryButton onClick={startExperiment}>説明へ進む</PrimaryButton>
                      <SecondaryButton onClick={requestMic}>マイク権限を再確認</SecondaryButton>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="space-y-4 text-base">
                      <StatusRow label="マイク状態" value={streamReady ? '準備完了' : '未許可'} success={streamReady} />
                      <StatusRow label="録音形式" value={pickBestAudioMimeType().mimeType || 'browser default'} />
                      {permissionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-lg leading-8 text-rose-700">
                          {permissionError}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-lg leading-8 text-emerald-700">
                          ページを開くと、ブラウザがマイク権限を確認します。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'instructions' && (
            <CardShell className="max-w-6xl">
              <div className="space-y-10">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <Badge>Instructions</Badge>
                  <div className="text-lg font-semibold text-slate-500">
                    {instructionPageIndex + 1} / {INSTRUCTION_PAGES.length}
                  </div>
                </div>

                <div className="min-h-[420px] rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10">
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
                    <InstructionIllustration type={instructionPage.visual} />

                    <div className="space-y-8">
                      <div className="inline-flex rounded-full bg-sky-50 px-4 py-2 text-lg font-semibold text-sky-700">
                        {instructionPage.badge}
                      </div>
                      <div className="space-y-5">
                        <h2 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
                          {instructionPage.title}
                        </h2>
                        <p className="text-2xl leading-10 text-slate-700">
                          {instructionPage.body}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-xl leading-9 text-sky-800">
                        {instructionPage.note}
                      </div>
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
                      {instructionReturnTarget === 'guidedPractice' ? 'ガイド付き練習に戻る' : '練習を開始する'}
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

          {phase === 'countdown' && (
            <CardShell className="max-w-6xl text-center">
              <div className="space-y-10">
                <Badge>{mode === 'practice' ? '練習' : '本番'} 単語 {currentTrialIndex + 1} / {activeStimuli.length}</Badge>
                {isGuidedPracticeTrial && (
                  <GuideBox>
                    これは操作ガイド付きの練習です。画面の案内を見ながら進めてください。
                  </GuideBox>
                )}
                <div className="mx-auto flex h-60 w-60 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-9xl font-semibold text-sky-600 shadow-xl shadow-sky-100 sm:h-72 sm:w-72">
                  {countdown}
                </div>
                <div className="space-y-3">
                  <h2 className="text-4xl font-semibold text-slate-900">まもなく単語が表示されます</h2>
                  <p className="text-xl leading-9 text-slate-600">
                    表示されたら読み上げ、読み終わったら Space キーを押してください。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'recording' && (
            <CardShell className="max-w-6xl text-center">
              <div className="space-y-12">
                <div className="space-y-3">
                  <Badge>Reading Recording</Badge>
                  <div className="text-lg text-slate-500">{mode === 'practice' ? '練習' : '本番'} 単語 {currentTrialIndex + 1} / {activeStimuli.length}</div>
                </div>

                {isGuidedPracticeTrial && (
                  <GuideBox>
                    単語を声に出して読んでください。読み終わったら Space キーを押します。
                  </GuideBox>
                )}

                <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-14 shadow-xl shadow-slate-200/50 sm:px-10 sm:py-16">
                  {/* <div className="mx-auto mb-6 flex h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)]" /> */}
                  <div className={`whitespace-nowrap font-semibold leading-none text-slate-900 ${getStimulusTextSizeClass(currentStimulus.text)}`}>
                    {currentStimulus.text}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-3xl font-medium text-slate-900">読み上げてください</p>
                  <p className="text-xl leading-9 text-slate-600">
                    読み終わったら <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-slate-700 border border-slate-200">Space</span> キーを押してください。
                  </p>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'meaningRecording' && (
            <CardShell className="max-w-6xl">
              <div className="space-y-8 text-center">
                <div className="space-y-3">
                  <Badge>Meaning Recording</Badge>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">意味や例文を声で答えてください</h2>
                  <div className="mx-auto inline-flex items-center gap-3 rounded-3xl border border-sky-200 bg-sky-50 px-6 py-4 text-2xl font-semibold text-slate-900 shadow-sm sm:text-3xl">
                    <span className="text-sky-700">対象語</span>
                    <span>{currentStimulus.text}</span>
                  </div>
                </div>

                {isGuidedPracticeTrial && (
                  <GuideBox>
                    この画面に進むと自動で録音が始まります。答え終わったら Space キーを押します。
                  </GuideBox>
                )}

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:px-10">
                  <div className="space-y-3 text-2xl leading-10 text-slate-700">
                    <p>意味を説明しても、この単語を使った文を作ってもかまいません。</p>
                    <p>わかる範囲で答えてください。</p>
                    <p>答え終わったら Space キーを押してください。</p>
                  </div>

                  <div className="mt-5 text-lg text-slate-500">
                    {tempMeaning?.audioBlob ? '音声回答が保存されました。' : isMeaningRecording ? '録音中です。Space キーで終了します。' : '録音を開始しています…'}
                  </div>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'survey' && (
            <SurveyForm stimulus={currentStimulus.text} isGuidedPractice={isGuidedPracticeTrial} onSubmit={submitSurvey} />
          )}

          {phase === 'guidedPracticeCheck' && (
            <CardShell className="max-w-6xl">
              <div className="space-y-8 text-center">
                <Badge>Practice Check</Badge>
                <div className="mx-auto max-w-4xl space-y-4">
                  <h2 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                    ここで一度確認します
                  </h2>
                  <p className="text-2xl leading-10 text-slate-700">
                    ガイド付き練習が終わりました。操作方法について不明な点があれば、実験者に質問してください。
                  </p>
                </div>

                <div className="grid gap-4 text-left sm:grid-cols-3">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-lg font-semibold text-sky-700">1. 読む</div>
                    <p className="mt-2 text-lg leading-8 text-slate-600">単語を読み終わったら Space キーを押します。</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-lg font-semibold text-sky-700">2. 答える</div>
                    <p className="mt-2 text-lg leading-8 text-slate-600">意味や例文を声で答えます。</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-lg font-semibold text-sky-700">3. 選ぶ</div>
                    <p className="mt-2 text-lg leading-8 text-slate-600">アンケートで 1〜5 の数字を選びます。</p>
                  </div>
                </div>

                <GuideBox>
                  必要であれば、説明をもう一度確認してから、ガイド付き練習に戻ることができます。
                </GuideBox>

                <div className="flex flex-col-reverse items-center justify-center gap-3 pt-2 sm:flex-row">
                  <SecondaryButton onClick={reviewInstructionsFromPracticeCheck}>説明をもう一度確認する</SecondaryButton>
                  <PrimaryButton onClick={beginNormalPractice}>通常練習へ進む</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'intermission' && (
            <CardShell className="max-w-6xl text-center">
              <div className="space-y-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
                  🎉
                </div>
                <div className="space-y-3">
                  <h2 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">練習が完了しました</h2>
                  <p className="text-xl leading-9 text-slate-600">
                    実験の流れは掴めましたでしょうか？<br />
                    ここから本番が始まります。準備ができたら開始ボタンを押してください。
                  </p>
                </div>
                <div className="flex justify-center pt-4">
                  <PrimaryButton onClick={beginMainExperiment}>本番を開始する</PrimaryButton>
                </div>
              </div>
            </CardShell>
          )}

          {phase === 'done' && (
            <CardShell className="max-w-6xl">
              <div className="space-y-8">
                <div className="space-y-3">
                  <Badge>Completed</Badge>
                  <h2 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">実験は以上です</h2>
                  <p className="text-3xl font-semibold leading-10 text-slate-900 sm:text-4xl">
                    ご協力いただき、誠にありがとうございました。
                  </p>
                  <p className="text-xl leading-9 text-slate-600">
                    すべての回答が保存されました。実験者がデータを保存しますので、少々お待ちください。
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoCard label="保存済み 本番データ" value={`${mainResults.length} 件`} />
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
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 text-lg font-semibold text-white">
                  {index + 1}
                </div>
                <div className="text-lg font-semibold text-slate-800">{label}</div>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-center text-xl font-semibold leading-8 text-amber-900">
            確認してから通常練習へ
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
  isGuidedPractice,
  onSubmit,
}: {
  stimulus: string;
  isGuidedPractice: boolean;
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
    <CardShell className="max-w-6xl">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Badge>Survey</Badge>
            <h2 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">アンケート</h2>
            <p className="text-xl leading-9 text-slate-600">
              対象語: <span className="font-semibold text-slate-900">{stimulus}</span>
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-semibold text-slate-600">
            {questionIndex + 1} / {SURVEY_QUESTIONS.length}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3" aria-label="質問の進捗">
          {SURVEY_QUESTIONS.map((question, index) => (
            <div
              key={question.key}
              className={`h-3 rounded-full transition ${index <= questionIndex ? 'bg-sky-500' : 'bg-slate-200'}`}
            />
          ))}
        </div>

        {isGuidedPractice && (
          <GuideBox>
            あてはまる数字を選んでください。数字を選ぶと、次の質問に進みます。
          </GuideBox>
        )}

        <LikertQuestion
          label={currentQuestion.label}
          description={currentQuestion.description}
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
          <p className="text-lg leading-8 text-slate-500">
            {isLastQuestion ? '数字を選ぶと次の単語に進みます。' : '数字を選ぶと次の質問に進みます。'}
          </p>
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
            <MiniPill label="段階" value={getPhaseDisplayLabel(phase)} />
            <MiniPill label="単語" value={`${Math.min(currentTrialIndex + 1, totalTrials)}/${totalTrials}`} />
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
      className={`inline-flex min-h-14 items-center justify-center whitespace-nowrap rounded-2xl px-6 py-4 text-lg font-medium transition ${disabled
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
      className={`inline-flex min-h-14 items-center justify-center whitespace-nowrap rounded-2xl border px-6 py-4 text-lg font-medium transition ${disabled
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
    <div className="inline-flex w-fit items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
      {children}
    </div>
  );
}

function MiniPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-semibold text-slate-800">{value}</span>
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
      <div className="text-lg font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function GuideBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5 text-center text-xl font-medium leading-9 text-amber-900 shadow-sm">
      {children}
    </div>
  );
}

function LikertQuestion({
  label,
  description,
  lowLabel,
  highLabel,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  lowLabel: string;
  highLabel: string;
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="space-y-4">
        <h3 className="text-3xl font-semibold leading-tight text-slate-900">{label}</h3>
        <p className="text-xl leading-9 text-slate-600">{description}</p>
      </div>

      <div className="mt-8 grid grid-cols-5 gap-2 sm:gap-3">
        {likertOptions().map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            disabled={disabled}
            className={`min-h-16 rounded-2xl border px-0 py-3 text-2xl font-semibold transition duration-150 ${value === n
              ? 'scale-105 border-sky-500 bg-sky-500 text-white shadow-lg shadow-sky-200'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-5 flex items-stretch justify-between gap-4 text-lg font-semibold text-slate-800">
        <span className="flex min-h-14 max-w-[45%] items-center rounded-2xl bg-slate-100 px-4 py-3 text-left leading-7">{lowLabel}</span>
        <span className="flex min-h-14 max-w-[45%] items-center justify-end rounded-2xl bg-slate-100 px-4 py-3 text-right leading-7">{highLabel}</span>
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
