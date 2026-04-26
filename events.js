/**
 * 活动日程配置
 * ============
 * 修改此文件即可更新页面上的活动日程，无需改动 HTML。
 *
 * 每个活动对象字段说明：
 *   title    — 活动名称
 *   date     — 日期，格式随意（如 "2026年3月22日"）
 *   time     — 时间段（如 "14:00 - 18:00"），可留空 ""，默认显示北京时间 (UTC+8)
 *   type     — "线上" 或 "线下"
 *   signupUrl— 报名链接，无报名填 ""
 *   active   — true 表示高亮显示（当前/即将举行）
 *   timezone — 时区说明，默认 "北京时间 UTC+8"，可覆盖如 "UTC+9"
 */
const EVENTS = [
  {
    title: "第一期 Card Clash Game Night",
    date: "2026年2月26日",
    time: "20:00 - 21:30",
    type: "线上",
    signupUrl: "",
    active: false,
    finished: true
  },
  {
    title: "第二期 Card Clash Game Night",
    date: "2026年4月28日",
    time: "20:00 - 21:30",
    type: "线上",
    signupUrl: "https://events.teams.microsoft.com/event/eaf149cc-0b21-43a6-96de-f7d6fb6fb80e@202230d0-e5b2-455b-9a54-44e6cbac435a",
    active: true
  }
];
