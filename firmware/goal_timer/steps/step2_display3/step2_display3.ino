/*
 * step2_display3.ino — ステップ2：表示器3台の数珠つなぎ（デイジーチェーン）の確認
 *
 * 5秒ごとに次の2つを切り替える。
 *   A) 台の順番の確認：Arduinoに近い順に「11111111」「22222222」「33333333」
 *   B) 電源の確認：3台とも全セグメント点灯「8.8.8.8.8.8.8.8.」（消費電流が最大になる状態）
 *
 * 配線：1台目は step1 のまま（DIN→D7 / CLK→D8 / CS→D9 / VCC→5V / GND→GND）。
 *       1台目の出力側（DOUT・CLK・CS・VCC・GND）を2台目の入力側へ、2台目の出力側を3台目の入力側へつなぐ。
 *
 * 合格条件：
 *   A) 1・2・3 の並びが、goal_timer.ino の DISP_LATEST(0)／DISP_PREV(1)／DISP_CLOCK(2) にしたい並びと合っている
 *   B) 全点灯でもちらつき・暗くなる・リセット（表示が消えてやり直しになる）が起きない
 */

#include <LedControl.h>

const uint8_t PIN_DISP_DIN = 7;
const uint8_t PIN_DISP_CLK = 8;
const uint8_t PIN_DISP_CS  = 9;
const uint8_t DISP_COUNT   = 3;
const uint8_t DISP_BRIGHT  = 8; // 表示の明るさ（0〜15）。goal_timer.ino と同じ値
const unsigned long PHASE_MS = 5000;

LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

void showOrder() {
  for (uint8_t dev = 0; dev < DISP_COUNT; dev++) {
    for (uint8_t i = 0; i < 8; i++) lc.setDigit(dev, i, dev + 1, false);
  }
}

void showAllOn() {
  for (uint8_t dev = 0; dev < DISP_COUNT; dev++) {
    for (uint8_t i = 0; i < 8; i++) lc.setDigit(dev, i, 8, true);
  }
}

void setup() {
  for (uint8_t dev = 0; dev < DISP_COUNT; dev++) {
    lc.shutdown(dev, false);
    lc.setIntensity(dev, DISP_BRIGHT);
    lc.clearDisplay(dev);
  }
}

void loop() {
  showOrder();
  delay(PHASE_MS);
  showAllOn();
  delay(PHASE_MS);
}
