/*
 * step0_blink.ino — ステップ0：開発環境と書き込みの確認
 *
 * 基板上のLED（D13）を「短く2回光る → 1秒休む」のくり返しで点滅させる。
 * 出荷時に入っていることが多い普通のBlink（1秒ごとの点滅）と見分けがつくようにしてある。
 * あわせてシリアルモニタ（9600bps）に1周ごとに1行出す。
 *
 * 合格条件：書き込み後、LEDが「ピカピカ・休み」のパターンで光る。
 */

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println(F("step0_blink: start"));
}

void loop() {
  for (uint8_t i = 0; i < 2; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(120);
    digitalWrite(LED_BUILTIN, LOW);
    delay(180);
  }
  Serial.println(F("blink"));
  delay(1000);
}
