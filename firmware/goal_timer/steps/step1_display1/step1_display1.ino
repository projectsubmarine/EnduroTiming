/*
 * step1_display1.ino — ステップ1：8桁7セグLED表示器（MAX7219）1台の確認
 *
 * 表示器1台に固定値「10052345」を表示する（6桁目の右に小数点 → "100523.45" に見える）。
 * 桁の並びと小数点の位置は goal_timer.ino の showTime() と同じ書き方にしてある。
 *
 * 配線（表示器の入力側＝DINのある側につなぐ。DOUT側ではない）：
 *   VCC → 5V / GND → GND / DIN → D7 / CLK → D8 / CS(LOAD) → D9
 *
 * 合格条件：左から「1 0 0 5 2 3. 4 5」と読め、全桁の明るさがそろっている。
 */

#include <LedControl.h>

const uint8_t PIN_DISP_DIN = 7;
const uint8_t PIN_DISP_CLK = 8;
const uint8_t PIN_DISP_CS  = 9;
const uint8_t DISP_BRIGHT  = 8; // 表示の明るさ（0〜15）

LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, 1);

void setup() {
  lc.shutdown(0, false);
  lc.setIntensity(0, DISP_BRIGHT);
  lc.clearDisplay(0);

  const uint8_t d[8] = { 1, 0, 0, 5, 2, 3, 4, 5 };
  for (uint8_t i = 0; i < 8; i++) {
    bool dp = (i == 5); // 左から6桁目の右にドット
    lc.setDigit(0, 7 - i, d[i], dp);
  }
}

void loop() {
}
