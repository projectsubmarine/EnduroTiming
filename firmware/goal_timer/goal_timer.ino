/*
 * goal_timer.ino — ゴール計測器（光電センサ＋GPS時刻＋7セグLED×3）
 *
 * 概要
 * -----
 * 光電センサでライダーの通過を検知し、GPSモジュールから取得した時刻（0時からの経過時間）を
 * 記録する。3台の8桁7セグメントLED表示器に「最新通過時刻」「ひとつ前の通過時刻」「現在時刻」を
 * 表示し続ける。GPSの測位状態は緑／赤2つのLEDで示す（緑＝受信良好、赤＝問題あり）。
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
 * 時刻合わせ：GPSの1PPS信号（秒の始まりのパルス）を基準にする。1PPSが無いと時計が0.4秒ほど遅れる。
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
const uint8_t PIN_SENSOR     = 2;  // 光電センサ出力（D2/D3のみ割り込み対応。センサ検知でLOWになる前提＝INPUT_PULLUP）
const uint8_t PIN_GPS_PPS    = 3;  // GPSモジュールの1PPS（秒の始まりを示す1秒ごとのパルス。D2/D3のみ割り込み対応）
const uint8_t PIN_GPS_LED_OK = 4;  // GPS受信良好LED（緑。+抵抗、GND側へ）
const uint8_t PIN_GPS_RX     = 5;  // ArduinoのRX ← GPSモジュールのTXへ接続
const uint8_t PIN_GPS_TX     = 6;  // ArduinoのTX → GPSモジュールのRXへ接続（受信専用なら未配線でも可）
const uint8_t PIN_DISP_DIN   = 7;  // 表示器チェーンのDIN（3台共通・デイジーチェーン）
const uint8_t PIN_DISP_CLK   = 8;  // 表示器チェーンのCLK（3台共通）
const uint8_t PIN_DISP_CS    = 9;  // 表示器チェーンのCS/LOAD（3台共通）
const uint8_t PIN_GPS_LED_NG = 10; // GPS受信注意LED（赤。+抵抗、GND側へ）

// LedControlのデバイス番号（Arduinoに近い側から0,1,2。README.mdの配線図参照）
const uint8_t DISP_LATEST = 0;   // 最新通過時刻
const uint8_t DISP_PREV   = 1;   // ひとつ前の通過時刻
const uint8_t DISP_CLOCK  = 2;   // 現在時刻

const uint8_t DISP_COUNT    = 3;
const uint8_t DISP_BRIGHT   = 8;    // 表示の明るさ（0〜15。屋外なら明るめ推奨）
const unsigned long GPS_BAUD      = 9600;
const unsigned long DEBOUNCE_MS   = 300;  // 検知が終わってからこの時間、信号が無ければ次の通過を受け付ける（連続通過の想定間隔に応じて調整）
const unsigned long GPS_STALE_MS  = 2000; // これより古いGPS時刻情報は同期に使わない
const unsigned long GPS_FIX_STALE_MS = 3000; // 位置情報がこれより古ければ「受信不良」とみなす（アンテナを覆ったとき等）
const unsigned long GPS_QUIET_MS  = 20;   // これだけ何も届かなければ、GPSの受信が一段落したとみなす
const unsigned long PPS_MIN_MS    = 950;  // 1PPSの間隔がこの範囲なら正しいパルスとみなす（ノイズ除け）
const unsigned long PPS_MAX_MS    = 1050;
const unsigned long PPS_MATCH_MS  = 950;  // 文が届いたとき、これ以内に来ていたパルスを「その文の秒の始まり」とみなす
const unsigned long PPS_LOST_MS   = 3000; // これだけパルスで合わせられなければ、文だけで合わせる方式に戻す
const unsigned long CLOCK_TICK_MS = 100;  // 現在時刻表示の更新間隔
const unsigned long HDOP_OK       = 500;  // HDOP(精度の目安)がこれ以下(×100した整数)なら測位良好とみなす。生値5.0=500

const uint32_t DAY_MS = 86400000UL;
const uint32_t TZ_OFFSET_MS = 9UL * 3600000UL; // GPSの時刻（UTC）に足す時差。日本時間＝+9時間

SoftwareSerial gpsSerial(PIN_GPS_RX, PIN_GPS_TX);
TinyGPSPlus gps;
LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

// --- GPSで同期した内部時計 ---
// GPSの新しい時刻が来るたびに「0時からのミリ秒」とそのときのmillis()を記録しておき、
// 表示のたびはmillis()との差分で進めた時刻を使う。GPSが一時的に途切れても表示は止まらない。
bool timeSynced = false;
uint32_t syncedMsOfDay  = 0;
unsigned long syncedAtMillis = 0;

// --- 1PPS（秒の始まりのパルス） ---
// GPSの文（NMEA）は、その秒が始まってから0.25〜0.4秒ほど遅れて届く。文が届いた瞬間で時計を合わせると
// その分だけ時計が遅れるので、秒の始まりちょうどに出る1PPSの瞬間を基準にし、文は
// 「そのパルスが何時何分何秒か」を知るためだけに使う。
// 秋月 AE-GYSFDMAXB の1PPS端子は、秒の始まりでLOWに下がる（実測）ので、立ち下がりで割り込む。
// 1PPSが来ていない間（未配線・測位前）は、文が届いた瞬間で合わせる（遅れたまま）。
volatile unsigned long ppsAtMillis = 0; // 最後のパルスが来た瞬間の millis()
volatile bool ppsValid = false;         // そのパルスが、前のパルスからほぼ1秒後に来た正しいものか
bool ppsSynced = false;                 // true＝1PPSで合わせている
unsigned long lastPpsSyncAt = 0;

// --- センサ検知 ---
// 1回の通過を1回だけ記録するため、いったん記録したら、信号が「検知していない状態」のまま
// DEBOUNCE_MS 続くまで次を受け付けない（センサが検知しっぱなし・出力のばたつき・
// 自転車の前輪と後輪で光が2回切れる、のどれも1回の通過として扱える）。
volatile bool armed = true;               // true＝次の通過を受け付けられる
volatile bool sensorFired = false;        // 新しい通過を検知した（loop()で記録・表示する）
volatile unsigned long firedAtMillis = 0; // その通過の最初の信号が入った瞬間の millis()
volatile unsigned long lastEdgeAt = 0;    // 最後に信号が入った millis()（受け付け再開の判定用）

bool hasLatest = false, hasPrev = false;
uint32_t latestMsOfDay = 0, prevMsOfDay = 0;

void onSensorInterrupt() {
  // 割り込み内は最小限（時刻の控えとフラグだけ）。記録や表示更新はloop()側で行う。
  // 通過の瞬間の millis() をここで控えるので、loop()側の処理（表示更新など）で時刻が遅れない。
  unsigned long now = millis();
  lastEdgeAt = now;
  if (armed) {
    armed = false;
    firedAtMillis = now;
    sensorFired = true;
  }
}

void onPpsInterrupt() {
  unsigned long now = millis();
  unsigned long interval = now - ppsAtMillis;
  ppsValid = (interval >= PPS_MIN_MS && interval <= PPS_MAX_MS);
  ppsAtMillis = now;
}

// millis() の値 at の時点の時刻（0時からのミリ秒）を返す
uint32_t msOfDayAt(unsigned long at) {
  if (!timeSynced) return 0;
  // at が直近の同期よりわずかに前（検知の直後にGPS同期が入った場合）でも正しく計算できるよう、差は符号付きで扱う
  int32_t delta = (int32_t)(at - syncedAtMillis);
  return (uint32_t)(syncedMsOfDay + DAY_MS + delta) % DAY_MS; // 日付をまたいだら0時に戻す
}

uint32_t currentMsOfDay() {
  return msOfDayAt(millis());
}

void syncFromGps() {
  if (!gps.time.isValid() || !gps.date.isValid()) return;
  if (gps.time.age() > GPS_STALE_MS) return; // 古い情報では同期しない
  uint32_t ms = ((uint32_t)gps.time.hour() * 3600UL
               + (uint32_t)gps.time.minute() * 60UL
               + (uint32_t)gps.time.second()) * 1000UL
               + (uint32_t)gps.time.centisecond() * 10UL;
  ms = (ms + TZ_OFFSET_MS) % DAY_MS; // UTC → 日本時間

  unsigned long now = millis();
  noInterrupts();
  unsigned long ppsAt = ppsAtMillis;
  bool valid = ppsValid;
  interrupts();

  if (valid && now - ppsAt < PPS_MATCH_MS) {
    // この文の時刻は、直前のパルスの瞬間の時刻
    syncedMsOfDay  = ms;
    syncedAtMillis = ppsAt;
    timeSynced = true;
    ppsSynced = true;
    lastPpsSyncAt = now;
  } else if (!ppsSynced || now - lastPpsSyncAt > PPS_LOST_MS) {
    // パルスが来ていない：文が届いた瞬間で合わせる（その分だけ時計は遅れる）
    syncedMsOfDay  = ms;
    syncedAtMillis = now;
    timeSynced = true;
    ppsSynced = false;
  }
}

bool gpsFixGood() {
  if (!gps.location.isValid() || !timeSynced) return false;
  if (gps.location.age() > GPS_FIX_STALE_MS) return false; // 測位できなくなっている
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
  pinMode(PIN_GPS_LED_OK, OUTPUT);
  pinMode(PIN_GPS_LED_NG, OUTPUT);
  digitalWrite(PIN_GPS_LED_OK, LOW);
  digitalWrite(PIN_GPS_LED_NG, LOW);
  attachInterrupt(digitalPinToInterrupt(PIN_SENSOR), onSensorInterrupt, FALLING);

  pinMode(PIN_GPS_PPS, INPUT_PULLUP); // 未配線のときにノイズで誤動作しないよう、内蔵プルアップでHIGHに固定しておく
  attachInterrupt(digitalPinToInterrupt(PIN_GPS_PPS), onPpsInterrupt, FALLING);

  gpsSerial.begin(GPS_BAUD);
  // GPSモジュールが出す文を RMC と GGA の2種類だけに絞る（時刻・測位状態・HDOPはこの2つで足りる）。
  // 初期設定のままだと毎秒の文字数が多すぎて、ソフトウェアシリアルの受信が追いつかず取りこぼす。
  // 電源を切ると設定は元に戻るので、起動のたびに送る（MediaTek系のGPS用のコマンド。D6→RXD が未配線なら何も起きない）。
  delay(500);
  gpsSerial.print(F("$PMTK314,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0*28\r\n"));

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
  static unsigned long lastRxAt = 0;
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
    lastRxAt = millis();
  }
  if (gps.time.isUpdated()) syncFromGps();
  // GPSの文を受信している最中は、ソフトウェアシリアルの受信処理にCPUをほぼ取られる。
  // その間に表示の更新など時間のかかる処理をすると受信バッファがあふれて文が欠けるので、
  // 受信が一段落する（GPS_QUIET_MS のあいだ何も届かない）まで後回しにする。
  // 通過の時刻は割り込みの中で控えてあるので、表示が少し遅れても記録される時刻は変わらない。
  bool gpsBusy = (millis() - lastRxAt < GPS_QUIET_MS);

  // --- GPS測位状態LED：緑＝受信良好、赤＝問題あり ---
  // 赤は状況によって点滅／点灯を使い分ける：
  //   ・一度も時刻同期できていない（探索中）→ 点滅
  //   ・過去に同期済みだが、現在は測位精度が悪い／位置情報が取れない → 点灯
  static unsigned long lastBlinkAt = 0;
  static bool blinkState = false;
  if (gpsFixGood()) {
    digitalWrite(PIN_GPS_LED_OK, HIGH);
    digitalWrite(PIN_GPS_LED_NG, LOW);
  } else {
    digitalWrite(PIN_GPS_LED_OK, LOW);
    if (!timeSynced) {
      if (millis() - lastBlinkAt > 400) {
        lastBlinkAt = millis();
        blinkState = !blinkState;
        digitalWrite(PIN_GPS_LED_NG, blinkState ? HIGH : LOW);
      }
    } else {
      digitalWrite(PIN_GPS_LED_NG, HIGH);
    }
  }

  // --- センサ検知：新しい通過を記録・表示 ---
  if (sensorFired && !gpsBusy) {
    noInterrupts();
    sensorFired = false;
    unsigned long at = firedAtMillis;
    interrupts();
    if (timeSynced) {
      if (hasLatest) { prevMsOfDay = latestMsOfDay; hasPrev = true; }
      latestMsOfDay = msOfDayAt(at);
      hasLatest = true;
      showTime(DISP_LATEST, latestMsOfDay);
      if (hasPrev) showTime(DISP_PREV, prevMsOfDay);
    }
    // timeSynced==false（GPS同期前）の通過は記録できない。赤LEDが点滅中は計測開始前と分かる。
  }

  // --- 受け付けの再開：検知していない状態が DEBOUNCE_MS 続いたら次の通過を受け付ける ---
  if (!armed) {
    unsigned long now = millis();
    noInterrupts();
    if (digitalRead(PIN_SENSOR) == LOW) lastEdgeAt = now; // まだ検知中
    if (now - lastEdgeAt >= DEBOUNCE_MS) armed = true;
    interrupts();
  }

  // --- 現在時刻表示（一定間隔で更新） ---
  static unsigned long lastClockAt = 0;
  if (!gpsBusy && millis() - lastClockAt >= CLOCK_TICK_MS) {
    lastClockAt = millis();
    if (timeSynced) showTime(DISP_CLOCK, currentMsOfDay());
  }
}
