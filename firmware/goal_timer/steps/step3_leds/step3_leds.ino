/*
 * step3_leds.ino — ステップ3：GPS状態LED（緑・赤）の確認
 *
 * goal_timer.ino で使う3つの状態を、順番にくり返し表示する。
 *   1) 受信良好            ：緑 点灯／赤 消灯（3秒）
 *   2) 探索中（未同期）    ：緑 消灯／赤 点滅（4秒）
 *   3) 同期済みだが受信不良：緑 消灯／赤 点灯（3秒）
 * いまどの状態かが分かるよう、1台目の表示器の右端に状態の番号（1〜3）を出す。
 *
 * 配線：D4 → 抵抗(220〜330Ω) → 緑LEDの足の長い方 → 足の短い方 → GND
 *       D10 → 抵抗(220〜330Ω) → 赤LEDの足の長い方 → 足の短い方 → GND
 *       表示器3台は step2 のまま。
 *
 * 合格条件：番号1〜3のそれぞれで、上の表のとおりに光る。
 */

#include <LedControl.h>

const uint8_t PIN_GPS_LED_OK = 4;  // 緑
const uint8_t PIN_GPS_LED_NG = 10; // 赤
const uint8_t PIN_DISP_DIN   = 7;
const uint8_t PIN_DISP_CLK   = 8;
const uint8_t PIN_DISP_CS    = 9;
const uint8_t DISP_COUNT     = 3;
const uint8_t DISP_BRIGHT    = 8;

LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

void showState(uint8_t n) {
  lc.setDigit(0, 0, n, false);
}

void setup() {
  pinMode(PIN_GPS_LED_OK, OUTPUT);
  pinMode(PIN_GPS_LED_NG, OUTPUT);
  for (uint8_t dev = 0; dev < DISP_COUNT; dev++) {
    lc.shutdown(dev, false);
    lc.setIntensity(dev, DISP_BRIGHT);
    lc.clearDisplay(dev);
  }
}

void loop() {
  // 1) 受信良好
  showState(1);
  digitalWrite(PIN_GPS_LED_OK, HIGH);
  digitalWrite(PIN_GPS_LED_NG, LOW);
  delay(3000);

  // 2) 探索中（赤点滅。goal_timer.ino と同じ400ms周期）
  showState(2);
  digitalWrite(PIN_GPS_LED_OK, LOW);
  for (uint8_t i = 0; i < 10; i++) {
    digitalWrite(PIN_GPS_LED_NG, (i % 2 == 0) ? HIGH : LOW);
    delay(400);
  }

  // 3) 同期済みだが受信不良
  showState(3);
  digitalWrite(PIN_GPS_LED_NG, HIGH);
  delay(3000);
}
