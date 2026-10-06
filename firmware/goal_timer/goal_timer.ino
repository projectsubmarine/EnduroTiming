/*
 * goal_timer.ino — ゴール計測器（光電センサ＋GPS時刻＋7セグLED×3）
 *
 * 概要
 * -----
 * 光電センサでライダーの通過を検知し、GPSモジュールから取得した時刻（0時からの経過時間）を
 * 記録する。3台の8桁7セグメントLED表示器に「最新通過時刻」「ひとつ前の通過時刻」「現在時刻」を
 * 表示し続ける。GPSの測位状態はLEDで示す。
 *
 * ゴールオフィシャルは、表示された時刻とBIBナンバー（目視確認）を、
 * レース計時集計ツール（index.html）の「③タイム入力」に手入力する。
 * このマイコンはPCやネットワークには一切接続しない（配線は電源とセンサ・GPS・表示器のみ）。
 *
 * 表示形式："HHMMSSff"（8桁、6桁目の右に小数点灯）→ 見た目は "100523.45"
 * これはレース計時集計ツールのタイム入力欄がそのまま受け付ける形式なので、
 * 表示されている数字をそのまま（小数点を含めて）入力すればよい。
 *
 * 必要ライブラリ（Arduino IDEの「ライブラリマネージャ」からインストール）：
 *   - TinyGPSPlus（Mikal Hart）
 *   - LedControl（Eberhard Fahle）
 *
 * 対象ボード：Arduino Nano / Uno など ATmega328P系（5V・16MHz）
 * 配線・部品は firmware/goal_timer/README.md を参照。
 */

#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>
#include <LedControl.h>

// ------------------------------------------------------------------
// ピン設定（README.md の配線表と対応させること）
// ------------------------------------------------------------------
const uint8_t PIN_SENSOR   = 2;  // 光電センサ出力（D2/D3のみ割り込み対応。センサ検知でLOWになる前提＝INPUT_PULLUP）
const uint8_t PIN_GPS_LED  = 4;  // GPS測位状態LED（+抵抗、GND側へ）
const uint8_t PIN_GPS_RX   = 5;  // ArduinoのRX ← GPSモジュールのTXへ接続
const uint8_t PIN_GPS_TX   = 6;  // ArduinoのTX → GPSモジュールのRXへ接続（受信専用なら未配線でも可）
const uint8_t PIN_DISP_DIN = 7;  // 表示器チェーンのDIN（3台共通・デイジーチェーン）
const uint8_t PIN_DISP_CLK = 8;  // 表示器チェーンのCLK（3台共通）
const uint8_t PIN_DISP_CS  = 9;  // 表示器チェーンのCS/LOAD（3台共通）

// LedControlのデバイス番号（Arduinoに近い側から0,1,2。README.mdの配線図参照）
const uint8_t DISP_LATEST = 0;   // 最新通過時刻
const uint8_t DISP_PREV   = 1;   // ひとつ前の通過時刻
const uint8_t DISP_CLOCK  = 2;   // 現在時刻

const uint8_t DISP_COUNT    = 3;
const uint8_t DISP_BRIGHT   = 8;    // 表示の明るさ（0〜15。屋外なら明るめ推奨）
const unsigned long GPS_BAUD      = 9600;
const unsigned long DEBOUNCE_MS   = 300;  // センサの誤multiple検知を防ぐ最短間隔（連続通過の想定間隔に応じて調整）
const unsigned long GPS_STALE_MS  = 2000; // これより古いGPS時刻情報は同期に使わない
const unsigned long CLOCK_TICK_MS = 100;  // 現在時刻表示の更新間隔
const unsigned long HDOP_OK       = 500;  // HDOP(精度の目安)がこれ以下(×100した整数)なら測位良好とみなす。生値5.0=500

const uint32_t DAY_MS = 86400000UL;

SoftwareSerial gpsSerial(PIN_GPS_RX, PIN_GPS_TX);
TinyGPSPlus gps;
LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

// --- GPSで同期した内部時計 ---
// GPSの新しい時刻が来るたびに「0時からのミリ秒」とそのときのmillis()を記録しておき、
// 表示のたびはmillis()との差分で進めた時刻を使う。GPSが一時的に途切れても表示は止まらない。
bool timeSynced = false;
uint32_t syncedMsOfDay  = 0;
unsigned long syncedAtMillis = 0;

// --- センサ検知 ---
volatile bool sensorFired = false;
unsigned long lastTriggerAt = 0;

bool hasLatest = false, hasPrev = false;
uint32_t latestMsOfDay = 0, prevMsOfDay = 0;

void onSensorInterrupt() {
  // 割り込み内は最小限（フラグを立てるだけ）。デバウンスや表示更新はloop()側で行う。
  sensorFired = true;
}

uint32_t currentMsOfDay() {
  if (!timeSynced) return 0;
  uint32_t t = syncedMsOfDay + (millis() - syncedAtMillis);
  if (t >= DAY_MS) t %= DAY_MS; // 日付をまたいだら0時に戻す
  return t;
}

void syncFromGps() {
  if (!gps.time.isValid() || !gps.date.isValid()) return;
  if (gps.time.age() > GPS_STALE_MS) return; // 古い情報では同期しない
  uint32_t ms = ((uint32_t)gps.time.hour() * 3600UL
               + (uint32_t)gps.time.minute() * 60UL
               + (uint32_t)gps.time.second()) * 1000UL
               + (uint32_t)gps.time.centisecond() * 10UL;
  syncedMsOfDay  = ms;
  syncedAtMillis = millis();
  timeSynced = true;
}

bool gpsFixGood() {
  if (!gps.location.isValid() || !timeSynced) return false;
  if (!gps.hdop.isValid()) return true; // HDOPが得られない機種でも、位置・時刻が有効なら良好とみなす
  return gps.hdop.value() <= HDOP_OK;
}

// 8桁7セグに「HHMMSSff」を表示する（6桁目＝秒の1の位の右にドット→ "100523.45" のように見える）
void showTime(uint8_t dev, uint32_t msOfDay) {
  uint32_t totalSec = msOfDay / 1000UL;
  uint8_t hh = (totalSec / 3600UL) % 24;
  uint8_t mm = (totalSec / 60UL) % 60UL;
  uint8_t ss = totalSec % 60UL;
  uint8_t ff = (uint8_t)((msOfDay % 1000UL) / 10UL); // 1/100秒
  uint8_t d[8] = { (uint8_t)(hh/10), (uint8_t)(hh%10), (uint8_t)(mm/10), (uint8_t)(mm%10),
                   (uint8_t)(ss/10), (uint8_t)(ss%10), (uint8_t)(ff/10), (uint8_t)(ff%10) };
  for (uint8_t i = 0; i < 8; i++) {
    bool dp = (i == 5); // 左から6桁目（0始まりでindex5）の右にドット
    lc.setDigit(dev, 7 - i, d[i], dp);
  }
}

void showBlank(uint8_t dev) {
  for (uint8_t i = 0; i < 8; i++) lc.setRow(dev, i, 0x00);
}

// 未同期であることを示す（全桁に "-" を表示）
void showDashes(uint8_t dev) {
  for (uint8_t i = 0; i < 8; i++) lc.setChar(dev, i, '-', false);
}

void setup() {
  pinMode(PIN_SENSOR, INPUT_PULLUP); // NPNオープンコレクタ（検知時にLOW）のセンサを想定
  pinMode(PIN_GPS_LED, OUTPUT);
  digitalWrite(PIN_GPS_LED, LOW);
  attachInterrupt(digitalPinToInterrupt(PIN_SENSOR), onSensorInterrupt, FALLING);

  gpsSerial.begin(GPS_BAUD);

  for (uint8_t i = 0; i < DISP_COUNT; i++) {
    lc.shutdown(i, false);
    lc.setIntensity(i, DISP_BRIGHT);
    lc.clearDisplay(i);
  }
  showDashes(DISP_LATEST);
  showDashes(DISP_PREV);
  showDashes(DISP_CLOCK);
}

void loop() {
  // --- GPSデータを読み進める ---
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
  if (gps.time.isUpdated()) syncFromGps();

  // --- GPS測位状態LED：点滅＝探索中／未同期、点灯＝測位良好 ---
  static unsigned long lastBlinkAt = 0;
  static bool blinkState = false;
  if (gpsFixGood()) {
    digitalWrite(PIN_GPS_LED, HIGH);
  } else if (millis() - lastBlinkAt > 400) {
    lastBlinkAt = millis();
    blinkState = !blinkState;
    digitalWrite(PIN_GPS_LED, blinkState ? HIGH : LOW);
  }

  // --- センサ検知（デバウンス付き） ---
  if (sensorFired) {
    sensorFired = false;
    unsigned long now = millis();
    if (timeSynced && (now - lastTriggerAt > DEBOUNCE_MS)) {
      lastTriggerAt = now;
      if (hasLatest) { prevMsOfDay = latestMsOfDay; hasPrev = true; }
      latestMsOfDay = currentMsOfDay();
      hasLatest = true;
      showTime(DISP_LATEST, latestMsOfDay);
      if (hasPrev) showTime(DISP_PREV, prevMsOfDay);
    }
    // timeSynced==false（GPS同期前）の通過は記録できない。GPS_LEDが点滅中は計測開始前と分かる。
  }

  // --- 現在時刻表示（一定間隔で更新） ---
  static unsigned long lastClockAt = 0;
  if (millis() - lastClockAt >= CLOCK_TICK_MS) {
    lastClockAt = millis();
    if (timeSynced) showTime(DISP_CLOCK, currentMsOfDay());
  }
}
