// 简体中文 (zh-CN) resources. Same keys as en-US.ts (enforced by the
// Messages type). Coaching cues are written for on-court use: short, spoken
// naturally, no trailing punctuation so speech sounds like a coach's call.

import type { Messages } from './index';

export const zhCN: Messages = {
  meta: {
    title: 'AI 网球教练',
    languageName: '中文',
  },

  intro: {
    heading: 'AI 网球教练',
    lead: '练习正手时实时反馈。所有分析都在这部手机上完成，视频不会被录制或上传。',
    steps: [
      '把手机放在**你的侧面、与底线平齐**，距离 4–6 米，确保**全身**都在画面里。',
      '在**设置**中选择你的持拍手。',
      '点击**开始**后正常击球即可。每一拍正手都会被自动识别，并给出一句提示。',
    ],
    note: '击球时刻是根据手臂动作*估算*的（应用看不到球和球拍）。评分是基于规则的粗略估计，不能代替教练的判断。',
    privacy: '隐私：摄像头画面、姿态数据和评分都不会离开本设备。语音反馈只使用设备自带的本地语音。',
  },

  buttons: {
    start: '开始',
    stop: '停止',
    voiceOn: '🔊 语音',
    voiceOff: '🔇 静音',
    settings: '⚙︎ 设置',
    demo: '试用演示（无需摄像头）',
    analyzeFile: '分析视频文件',
    done: '完成',
    close: '关闭',
  },

  titles: {
    voice: '语音反馈',
    settings: '设置',
  },

  status: {
    notStarted: '未开始',
    stopped: '已停止',
    live: '实时',
    demo: '演示',
    file: '视频文件',
    loadingModel: '正在加载姿态模型…',
    startingDemo: '正在启动演示…',
    startingCamera: '正在启动摄像头…',
    openingVideo: '正在打开视频…',
    couldNotStart: '无法开始',
  },

  phases: {
    ready: '准备就绪',
    preparation: '准备',
    backswing: '引拍',
    'forward swing': '向前挥拍',
    'follow-through': '随挥',
    analyzing: '分析中',
  },

  live: {
    noPlayer: '未检测到球员',
    bodyNotVisible: '身体未完全入镜',
    fps: '{fps} 帧/秒',
    inference: '{ms} 毫秒',
  },

  score: {
    lastStroke: '上一拍',
    strokeNumber: ' · 第 {n} 拍',
    chip: '第{n}拍',
    historyEmpty: '击球记录会显示在这里。',
    historyLabel: '最近几拍的得分',
    feedbackMeta: '第 {n} 拍 · 得分 {score}',
    notSpoken: ' · 仅显示（未播报）',
    noVoice: ' · 未播报：没有本地语音',
  },

  categories: {
    preparation: '准备',
    rotation: '转体',
    balance: '平衡',
    weightTransfer: '重心转移',
    contact: '击球点',
    timing: '节奏',
    followThrough: '随挥',
  },

  metrics: {
    shoulderTurnDeg: '转肩角度',
    hipTurnDeg: '转髋角度',
    separationDeg: '肩髋分离',
    unitTurnLeadMs: '挥拍前完成转体',
    contactForwardRatio: '击球点在髋部前方',
    contactHeightRatio: '击球点高于髋部',
    elbowAngleAtContactDeg: '击球时肘部角度',
    weightTransferRatio: '髋部前移',
    trunkLeanDeg: '躯干前倾',
    headDriftRatio: '头部晃动',
    forwardSwingMs: '向前挥拍时间',
    followThroughHeightRatio: '收拍高于肩部',
    peakWristSpeed: '手腕峰值速度',
  },

  units: {
    deg: '°',
    ms: ' 毫秒',
    torso: ' 倍躯干',
    speed: ' 倍躯干/秒',
  },

  details: {
    title: '击球详情',
    feedbackDelay: '击球后反馈用时',
    confidence: '测量可信度',
    why: '反馈依据',
  },

  reasons: {
    visibility: '身体没有看清（可信度 {pct}%）',
    improvement: '上次提醒的问题已经改善',
    repeat: '最近 {window} 拍中有 {count} 拍出现同一问题',
    issue: '这一拍最主要的问题（严重度 {severity}）',
    praise: '没有明显问题',
    modest: '没有单一明显问题，但总分一般',
  },

  settings: {
    title: '设置',
    language: 'Language / 语言',
    hand: '持拍手',
    handRight: '右手',
    handLeft: '左手',
    net: '球网在画面的哪一侧',
    netAuto: '自动识别',
    netLeft: '左侧',
    netRight: '右侧',
    camera: '摄像头',
    cameraBack: '后置摄像头',
    cameraFront: '前置摄像头',
    rate: '姿态分析频率：',
    fpsUnit: '帧/秒',
    rateNote: '如果手机发热或跟不上，可以调低频率；应用也会自动降低。更改将在下次点击“开始”时生效。',
  },

  summary: {
    title: '训练总结',
    noStrokes: '没有识别到正手击球。请确认全身都在画面里，并且手机放在你的侧面。',
    forehands: '识别到的正手',
    average: '平均得分',
    best: '最佳一拍',
    trend: '近期趋势',
    trendImproving: '进步中',
    trendSteady: '稳定',
    trendDeclining: '下滑',
    perStroke: '（每拍 {value}）',
    mostFrequentIssue: '最常见的问题',
    none: '无',
    times: '{n} 次',
    strongest: '最强项',
    weakest: '需要加强',
    sparkLabel: '每拍得分：{scores}',
  },

  errors: {
    cameraInsecure: '摄像头需要 HTTPS 连接。请通过 https:// 或 localhost 打开应用。',
    cameraUnsupported: '此浏览器不支持摄像头。',
    cameraDenied: '摄像头权限被拒绝。请允许访问摄像头后重试。',
    cameraNotFound: '此设备上没有找到摄像头。',
    cameraOther: '无法启动摄像头：{message}',
    startFailed: '无法开始：{message}',
    processing: '处理出错：{message}',
  },

  notices: {
    noLocalVoice: '语音反馈已关闭：此设备没有本地{language}语音。反馈会以文字显示。',
  },

  coaching: {
    issues: {
      'late-contact': {
        now: '击球点太晚了',
        repeated: '连续几拍击球点都偏晚',
        improved: '很好，击球点更靠前了',
      },
      'early-contact': {
        now: '击球点太靠前了',
        repeated: '几拍都够得太远，让球再进来一点',
        improved: '很好，击球距离合适了',
      },
      'late-preparation': {
        now: '准备再早一点',
        repeated: '准备一直偏晚，球一出来就转身',
        improved: '很好，准备更早了',
      },
      'small-shoulder-turn': {
        now: '转肩更充分一些',
        repeated: '转肩一直不够，引拍时再多转一点',
        improved: '很好，转肩更充分了',
      },
      'small-hip-turn': {
        now: '转髋再多一点',
        repeated: '多用髋部，引拍时把髋转进去',
        improved: '很好，转髋到位了',
      },
      'no-weight-transfer': {
        now: '重心向前送',
        repeated: '几拍重心都没跟上，向前迎球',
        improved: '很好，重心向前了',
      },
      'leaning-back': {
        now: '身体再稳一点',
        repeated: '身体总是后仰，重心压在脚上',
        improved: '很好，平衡更稳了',
      },
      'unstable-head': {
        now: '头部保持稳定',
        repeated: '头一直在晃，击球时稳住',
        improved: '很好，头部稳住了',
      },
      'narrow-stance': {
        now: '站位再宽一点',
        repeated: '站位一直太窄，两脚再分开些',
        improved: '很好，站位稳了',
      },
      'cramped-arm': {
        now: '离球再远一点',
        repeated: '几拍都太挤，击球前调整步伐',
        improved: '很好，击球空间合适了',
      },
      'arm-only-swing': {
        now: '用身体转动带拍',
        repeated: '一直在用手臂打，让身体转起来',
        improved: '很好，身体转起来了',
      },
      'swing-hitch': {
        now: '挥拍再连贯一点',
        repeated: '挥拍中间有停顿，保持流畅',
        improved: '很好，挥拍更流畅了',
      },
      'short-follow-through': {
        now: '随挥再完整一点',
        repeated: '随挥总是不完整，收拍到肩上',
        improved: '很好，随挥完整了',
      },
      'short-swing-path': {
        now: '挥拍穿过球',
        repeated: '挥拍总是停得太早，向前送出去',
        improved: '很好，挥拍送出去了',
      },
    },
    praise: {
      preparation: '准备很早，很好',
      rotation: '转肩很好',
      balance: '平衡很好',
      weightTransfer: '重心转移很好',
      contact: '击球点很好',
      timing: '挥拍很流畅',
      followThrough: '随挥很完整',
    },
    goodStroke: '好球',
    okStroke: '还可以，继续',
    visibility: '这一拍没看清',
    visibilityRepeated: '请让全身都在画面里',
  },
};
