// English (en-US) resources. This file defines the shape of all localized
// resources; other languages must provide exactly the same keys (see
// Messages in ./index.ts). Placeholders use {name} and are filled by fmt().

import type { CategoryId } from '../types';
import type { IssueId } from '../coaching/issues';
import type { LivePhase } from '../session/CoachSession';

interface IssueText {
  /** Said for a single occurrence. Must be very short. */
  now: string;
  /** Said when the issue keeps recurring. */
  repeated: string;
  /** Said when a recently mentioned issue has been fixed. */
  improved: string;
}

export const enUS = {
  meta: {
    title: 'AI Tennis Coach',
    languageName: 'English',
  },

  intro: {
    heading: 'AI Tennis Coach',
    lead: 'Forehand feedback while you practice. Everything runs on this phone. Video is never recorded or uploaded.',
    steps: [
      'Stand the phone **beside you, level with the baseline**, 4–6 m away, so your **whole body** is in view.',
      'Set your dominant hand in **Settings**.',
      'Tap **Start** and just keep hitting. The app picks up each forehand and tells you one thing about it.',
    ],
    note: "Contact timing is *estimated* from your arm movement, because the app doesn't see the ball or racket. The scores are rough, rule-based estimates, not a coach's judgement.",
    privacy: 'Privacy: camera video, pose data and scores never leave this device. Voice feedback uses on-device voices only.',
  },

  buttons: {
    start: 'Start',
    stop: 'Stop',
    voiceOn: '🔊 Voice',
    voiceOff: '🔇 Muted',
    settings: '⚙︎ Settings',
    demo: 'Try demo (no camera)',
    analyzeFile: 'Analyze a video file',
    done: 'Done',
    close: 'Close',
  },

  titles: {
    voice: 'Voice feedback',
    settings: 'Settings',
  },

  status: {
    notStarted: 'Not started',
    stopped: 'Stopped',
    live: 'Live',
    demo: 'Demo',
    file: 'Video file',
    loadingModel: 'Loading pose model…',
    startingDemo: 'Starting demo…',
    startingCamera: 'Starting camera…',
    openingVideo: 'Opening video…',
    couldNotStart: 'Could not start',
  },

  phases: {
    ready: 'Ready',
    preparation: 'Preparation',
    backswing: 'Backswing',
    'forward swing': 'Forward swing',
    'follow-through': 'Follow-through',
    analyzing: 'Analyzing',
  } satisfies Record<LivePhase, string>,

  live: {
    noPlayer: 'No player detected',
    bodyNotVisible: 'Body not fully visible',
    fps: '{fps} fps',
    inference: '{ms} ms',
  },

  score: {
    lastStroke: 'Last stroke',
    strokeNumber: ' · #{n}',
    chip: '#{n}',
    historyEmpty: 'Stroke history will appear here.',
    historyLabel: 'Recent stroke scores',
    feedbackMeta: 'Stroke {n} · score {score}',
    notSpoken: ' · shown only (not spoken)',
    noVoice: ' · not spoken: no on-device voice',
  },

  categories: {
    preparation: 'Preparation',
    rotation: 'Rotation',
    balance: 'Balance',
    weightTransfer: 'Weight transfer',
    contact: 'Contact point',
    timing: 'Timing',
    followThrough: 'Follow-through',
  } satisfies Record<CategoryId, string>,

  metrics: {
    shoulderTurnDeg: 'Shoulder turn',
    hipTurnDeg: 'Hip turn',
    separationDeg: 'Shoulder-hip separation',
    unitTurnLeadMs: 'Turn completed before swing',
    contactForwardRatio: 'Contact in front of hips',
    contactHeightRatio: 'Contact height above hips',
    elbowAngleAtContactDeg: 'Elbow angle at contact',
    weightTransferRatio: 'Hip travel forward',
    trunkLeanDeg: 'Trunk lean (into shot)',
    headDriftRatio: 'Head movement',
    forwardSwingMs: 'Forward swing',
    followThroughHeightRatio: 'Finish above shoulders',
    peakWristSpeed: 'Peak wrist speed',
  },

  units: {
    deg: '°',
    ms: ' ms',
    torso: ' T',
    speed: ' T/s',
  },

  details: {
    title: 'Stroke details',
    feedbackDelay: 'Feedback ready after contact',
    confidence: 'Measurement confidence',
    why: 'Why this feedback',
  },

  reasons: {
    visibility: 'The body was not clearly visible ({pct}% confidence)',
    improvement: 'The last issue you heard about is fixed',
    repeat: 'Same issue in {count} of the last {window} strokes',
    issue: 'Biggest issue on this stroke (severity {severity})',
    praise: 'No notable issue',
    modest: 'No single clear issue, but the overall score is modest',
  },

  settings: {
    title: 'Settings',
    language: 'Language / 语言',
    hand: 'Dominant hand',
    handRight: 'Right-handed',
    handLeft: 'Left-handed',
    net: 'Net is on the … side of the screen',
    netAuto: 'Detect automatically',
    netLeft: 'Left',
    netRight: 'Right',
    camera: 'Camera',
    cameraBack: 'Back camera',
    cameraFront: 'Front camera',
    rate: 'Pose analysis rate:',
    fpsUnit: 'fps',
    rateNote:
      'Lower the rate if the phone gets hot or struggles to keep up. The app also reduces it automatically. Changes apply the next time you press Start.',
  },

  summary: {
    title: 'Session summary',
    noStrokes: 'No forehands were detected. Check that your whole body is visible and the phone is beside you.',
    forehands: 'Forehands detected',
    average: 'Average score',
    best: 'Best stroke',
    trend: 'Recent trend',
    trendImproving: 'improving',
    trendSteady: 'steady',
    trendDeclining: 'declining',
    perStroke: '({value}/stroke)',
    mostFrequentIssue: 'Most frequent issue',
    none: 'None',
    times: '{n}×',
    strongest: 'Strongest area',
    weakest: 'Area to work on',
    sparkLabel: 'Stroke scores: {scores}',
  },

  errors: {
    cameraInsecure: 'Camera requires HTTPS. Open the app via https:// or localhost.',
    cameraUnsupported: 'Camera API not available in this browser.',
    cameraDenied: 'Camera permission was denied. Allow camera access and try again.',
    cameraNotFound: 'No camera found on this device.',
    cameraOther: 'The camera could not be started: {message}',
    startFailed: 'Could not start: {message}',
    processing: 'Processing error: {message}',
  },

  notices: {
    noLocalVoice: 'Voice feedback is off: this device has no on-device {language} voice. Feedback is shown on screen instead.',
  },

  coaching: {
    issues: {
      'late-contact': {
        now: 'Contact point was too late.',
        repeated: 'Your contact point has been late for several strokes.',
        improved: 'Good, your contact point is earlier now.',
      },
      'early-contact': {
        now: 'You reached too far in front.',
        repeated: 'You keep reaching too far forward. Let the ball come in.',
        improved: 'Better contact distance.',
      },
      'late-preparation': {
        now: 'Prepare a little earlier.',
        repeated: 'Preparation has been late. Turn as soon as the ball leaves the machine.',
        improved: 'Good, earlier preparation.',
      },
      'small-shoulder-turn': {
        now: 'Rotate your shoulders more.',
        repeated: 'Keep working on a bigger shoulder turn.',
        improved: 'Better shoulder turn.',
      },
      'small-hip-turn': {
        now: 'Turn your hips more.',
        repeated: 'Use your hips. Load them on the backswing.',
        improved: 'Better hip turn.',
      },
      'no-weight-transfer': {
        now: 'Transfer your weight forward.',
        repeated: 'Keep stepping into the ball.',
        improved: 'Better weight transfer.',
      },
      'leaning-back': {
        now: 'Stay more balanced.',
        repeated: 'You keep leaning back. Stay over your feet.',
        improved: 'Better balance.',
      },
      'unstable-head': {
        now: 'Keep your head still.',
        repeated: 'Your head keeps moving. Stay steady through contact.',
        improved: 'Steadier head. Good.',
      },
      'narrow-stance': {
        now: 'Widen your stance.',
        repeated: 'Your stance keeps being narrow. Get a wider base.',
        improved: 'Better base.',
      },
      'cramped-arm': {
        now: 'Give yourself more space.',
        repeated: 'You keep getting cramped. Move away from the ball.',
        improved: 'Better spacing.',
      },
      'arm-only-swing': {
        now: 'Rotate through the ball.',
        repeated: 'Your arm is swinging alone. Let the body rotate.',
        improved: 'Better rotation through contact.',
      },
      'swing-hitch': {
        now: 'Keep the swing smooth.',
        repeated: 'There is a pause in your swing. Keep it flowing.',
        improved: 'Smoother swing.',
      },
      'short-follow-through': {
        now: 'Finish the follow-through.',
        repeated: 'Keep finishing over your shoulder.',
        improved: 'Better follow-through.',
      },
      'short-swing-path': {
        now: 'Swing through the ball.',
        repeated: 'Your swing keeps stopping early. Swing through.',
        improved: 'Better extension through the ball.',
      },
    } satisfies Record<IssueId, IssueText>,
    praise: {
      preparation: 'Good early preparation.',
      rotation: 'Good shoulder rotation.',
      balance: 'Nice balance.',
      weightTransfer: 'Good weight transfer.',
      contact: 'Good contact point.',
      timing: 'Nice smooth swing.',
      followThrough: 'Good follow-through.',
    } satisfies Record<CategoryId, string>,
    goodStroke: 'Good stroke.',
    okStroke: 'Okay. Keep going.',
    visibility: "Couldn't see that one clearly.",
    visibilityRepeated: 'Make sure your whole body is in the picture.',
  },
};
