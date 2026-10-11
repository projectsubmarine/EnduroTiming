/*
 * step4_sensor.ino — ステップ4：通過検知（光電センサ。当面はタクトスイッチで代用）の確認
 *
 * GPSはまだ使わず、「電源を入れてからの経過時間」を仮の時刻として使う。
 *
 * 検知のしかた（1回の通過を1回だけ記録するための工夫）：
 *   ・最初に信号が入った瞬間の時刻を、割り込みの中で記録する（表示の更新などで遅れない）。
 *   ・いったん記録したら、信号が「検知していない状態」のまま DEBOUNCE_MS 続くまで次を受け付けない。
 *     → 押しっぱなし・離すときの接点のばたつき・自転車の前輪と後輪で光が2回切れる、
 *       のどれも1回の通過として扱える。
 *   表示器① 最新の検知時刻 ／ 表示器② ひとつ前の検知時刻 ／ 表示器③ 仮の現在時刻（常時更新）
 * 検知するまで①②は「--------」。緑LEDは点灯したまま（受信良好のつもり）。
 *
 * シリアルモニタ（9600bps）には、検知のたびに時刻を、次を受け付けられる状態に戻ったときに
 * 「その通過のあいだに入った信号の回数」を出す。回数が2以上なら、ばたつきを吸収したということ。
 *
 * 配線：D2 と GND の間にタクトスイッチ（抵抗は不要。押すとLOW＝NPNセンサの検知と同じ）。
 *       表示器3台・LED2個は step3 のまま。
 *
 * 合格条件：
 *   ・押すと①にそのときの時刻が出て、次に押すと①の値が②に移り、①が新しい時刻になる
 *   ・1回押して1回だけ記録される（短く押す／長く押してから離す、の両方で確認）
 *   ・離してから DEBOUNCE_MS 以内にもう一度押しても記録されない
 */

#include <LedControl.h>

const uint8_t PIN_SENSOR     = 2;
const uint8_t PIN_GPS_LED_OK = 4;
const uint8_t PIN_GPS_LED_NG = 10;
const uint8_t PIN_DISP_DIN   = 7;
const uint8_t PIN_DISP_CLK   = 8;
const uint8_t PIN_DISP_CS    = 9;

const uint8_t DISP_LATEST = 0;
const uint8_t DISP_PREV   = 1;
const uint8_t DISP_CLOCK  = 2;
const uint8_t DISP_COUNT  = 3;
const uint8_t DISP_BRIGHT = 8;

const unsigned long DEBOUNCE_MS   = 300; // 検知が終わってからこの時間、信号が無ければ次の通過を受け付ける
const unsigned long CLOCK_TICK_MS = 100;
const uint32_t DAY_MS = 86400000UL;

LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

volatile bool armed = true;            // true＝次の通過を受け付けられる
volatile bool sensorFired = false;     // 新しい通過を記録した（loop()で表示に反映する）
volatile unsigned long firedAtMillis = 0; // その通過の最初の信号が入った瞬間の millis()
volatile unsigned long lastEdgeAt = 0;    // 最後に信号が入った millis()（受け付け再開の判定用）
volatile uint16_t edgeCount = 0;       // 確認用：割り込みが入った回数

bool hasLatest = false, hasPrev = false;
uint32_t latestMsOfDay = 0, prevMsOfDay = 0;

void onSensorInterrupt() {
  unsigned long now = millis();
  lastEdgeAt = now;
  edgeCount++;
  if (armed) {
    armed = false;
    firedAtMillis = now;
    sensorFired = true;
  }
}

// 仮の時刻：電源を入れてからの経過ミリ秒（at は millis() の値）
uint32_t msOfDayAt(unsigned long at) {
  return at % DAY_MS;
}

void showTime(uint8_t dev, uint32_t msOfDay) {
  uint32_t totalSec = msOfDay / 1000UL;
  uint8_t hh = (totalSec / 3600UL) % 24;
  uint8_t mm = (totalSec / 60UL) % 60UL;
  uint8_t ss = totalSec % 60UL;
  uint8_t ff = (uint8_t)((msOfDay % 1000UL) / 10UL);
  uint8_t d[8] = { (uint8_t)(hh/10), (uint8_t)(hh%10), (uint8_t)(mm/10), (uint8_t)(mm%10),
                   (uint8_t)(ss/10), (uint8_t)(ss%10), (uint8_t)(ff/10), (uint8_t)(ff%10) };
  for (uint8_t i = 0; i < 8; i++) {
    bool dp = (i == 5);
    lc.setDigit(dev, 7 - i, d[i], dp);
  }
}

void showDashes(uint8_t dev) {
  for (uint8_t i = 0; i < 8; i++) lc.setChar(dev, i, '-', false);
}

void setup() {
  pinMode(PIN_SENSOR, INPUT_PULLUP);
  pinMode(PIN_GPS_LED_OK, OUTPUT);
  pinMode(PIN_GPS_LED_NG, OUTPUT);
  digitalWrite(PIN_GPS_LED_OK, HIGH);
  digitalWrite(PIN_GPS_LED_NG, LOW);
  attachInterrupt(digitalPinToInterrupt(PIN_SENSOR), onSensorInterrupt, FALLING);

  Serial.begin(9600);
  Serial.println(F("step4_sensor: start"));

  for (uint8_t i = 0; i < DISP_COUNT; i++) {
    lc.shutdown(i, false);
    lc.setIntensity(i, DISP_BRIGHT);
    lc.clearDisplay(i);
  }
  showDashes(DISP_LATEST);
  showDashes(DISP_PREV);
}

void loop() {
  // --- 新しい通過を表示に反映 ---
  if (sensorFired) {
    noInterrupts();
    sensorFired = false;
    unsigned long at = firedAtMillis;
    interrupts();

    if (hasLatest) { prevMsOfDay = latestMsOfDay; hasPrev = true; }
    latestMsOfDay = msOfDayAt(at);
    hasLatest = true;
    showTime(DISP_LATEST, latestMsOfDay);
    if (hasPrev) showTime(DISP_PREV, prevMsOfDay);

    Serial.print(F("detect ms="));
    Serial.println(latestMsOfDay);
  }

  // --- 受け付けの再開：検知していない状態が DEBOUNCE_MS 続いたら次の通過を受け付ける ---
  if (!armed) {
    unsigned long now = millis();
    noInterrupts();
    if (digitalRead(PIN_SENSOR) == LOW) lastEdgeAt = now; // まだ検知中（押しっぱなし）
    bool quiet = (now - lastEdgeAt >= DEBOUNCE_MS);
    uint16_t edges = edgeCount;
    if (quiet) { armed = true; edgeCount = 0; }
    interrupts();
    if (quiet) {
      Serial.print(F("ready edges="));
      Serial.println(edges);
    }
  }

  static unsigned long lastClockAt = 0;
  if (millis() - lastClockAt >= CLOCK_TICK_MS) {
    lastClockAt = millis();
    showTime(DISP_CLOCK, msOfDayAt(millis()));
  }
}
