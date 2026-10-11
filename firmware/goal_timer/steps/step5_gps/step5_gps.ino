/*
 * step5_gps.ino — ステップ5：GPSモジュールの受信と時刻表示の確認
 *
 * 1) GPSモジュールから届いた文字（NMEA文）を、そのままシリアルモニタ（115200bps）に流す。
 * 2) 2秒ごとに「# 」で始まる要約行（受信文字数・チェックサム合格/不合格の数・衛星数・HDOP・時刻）を出す。
 * 3) 時刻が取れたら、日本時間（UTC+9時間）にして表示器③に出す。①には衛星数を出す。
 *    LEDは goal_timer.ino と同じ（緑＝受信良好／赤点滅＝探索中／赤点灯＝同期済みだが受信不良）。
 *
 * 配線（秋月 AE-GYSFDMAXB の場合）：
 *   5V → 5V / GND → GND / TXD → D5 / RXD → D6（未配線でも可）/ 1PPS → まだつながない
 *   表示器3台・LED2個・スイッチは step4 のまま。
 *
 * 合格条件：
 *   ・シリアルモニタに「$GP...」「$GN...」などで始まる行が毎秒流れる（配線と通信速度が合っている）
 *   ・屋外か窓際でしばらく待つと緑LEDが点灯し、表示器③の時・分・秒がスマホの時計と合う
 */

#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>
#include <LedControl.h>

const uint8_t PIN_GPS_LED_OK = 4;
const uint8_t PIN_GPS_RX     = 5;  // ArduinoのRX ← GPSモジュールのTXD
const uint8_t PIN_GPS_TX     = 6;  // ArduinoのTX → GPSモジュールのRXD
const uint8_t PIN_DISP_DIN   = 7;
const uint8_t PIN_DISP_CLK   = 8;
const uint8_t PIN_DISP_CS    = 9;
const uint8_t PIN_GPS_LED_NG = 10;

const uint8_t DISP_LATEST = 0;
const uint8_t DISP_PREV   = 1;
const uint8_t DISP_CLOCK  = 2;
const uint8_t DISP_COUNT  = 3;
const uint8_t DISP_BRIGHT = 8;

const unsigned long GPS_BAUD      = 9600;
const unsigned long GPS_STALE_MS  = 2000;
const unsigned long CLOCK_TICK_MS = 100;
const unsigned long GPS_QUIET_MS  = 20;   // これだけ何も届かなければ、GPSの受信が一段落したとみなす
const unsigned long HDOP_OK       = 500;
const uint32_t DAY_MS = 86400000UL;
const uint32_t TZ_OFFSET_MS = 9UL * 3600000UL; // 日本時間＝UTC+9時間

SoftwareSerial gpsSerial(PIN_GPS_RX, PIN_GPS_TX);
TinyGPSPlus gps;
LedControl lc(PIN_DISP_DIN, PIN_DISP_CLK, PIN_DISP_CS, DISP_COUNT);

bool timeSynced = false;
uint32_t syncedMsOfDay = 0;
unsigned long syncedAtMillis = 0;

uint32_t currentMsOfDay() {
  if (!timeSynced) return 0;
  return (syncedMsOfDay + (millis() - syncedAtMillis)) % DAY_MS;
}

void syncFromGps() {
  if (!gps.time.isValid() || !gps.date.isValid()) return;
  if (gps.time.age() > GPS_STALE_MS) return;
  uint32_t ms = ((uint32_t)gps.time.hour() * 3600UL
               + (uint32_t)gps.time.minute() * 60UL
               + (uint32_t)gps.time.second()) * 1000UL
               + (uint32_t)gps.time.centisecond() * 10UL;
  syncedMsOfDay  = (ms + TZ_OFFSET_MS) % DAY_MS;
  syncedAtMillis = millis();
  timeSynced = true;
}

bool gpsFixGood() {
  if (!gps.location.isValid() || !timeSynced) return false;
  if (!gps.hdop.isValid()) return true;
  return gps.hdop.value() <= HDOP_OK;
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

// 表示器の右端2桁に数（0〜99）を出す
void showNumber(uint8_t dev, uint8_t n) {
  lc.clearDisplay(dev);
  if (n > 99) n = 99;
  if (n >= 10) lc.setDigit(dev, 1, n / 10, false);
  lc.setDigit(dev, 0, n % 10, false);
}

void printSummary() {
  Serial.print(F("\r\n# chars="));
  Serial.print(gps.charsProcessed());
  Serial.print(F(" ok="));
  Serial.print(gps.passedChecksum());
  Serial.print(F(" ng="));
  Serial.print(gps.failedChecksum());
  Serial.print(F(" sats="));
  if (gps.satellites.isValid()) Serial.print(gps.satellites.value()); else Serial.print('-');
  Serial.print(F(" hdop="));
  if (gps.hdop.isValid()) Serial.print(gps.hdop.value()); else Serial.print('-');
  Serial.print(F(" loc="));
  Serial.print(gps.location.isValid() ? F("valid") : F("none"));
  Serial.print(F(" jst_ms="));
  if (timeSynced) Serial.print(currentMsOfDay()); else Serial.print('-');
  Serial.print(F(" good="));
  Serial.println(gpsFixGood() ? 1 : 0);
}

void setup() {
  pinMode(PIN_GPS_LED_OK, OUTPUT);
  pinMode(PIN_GPS_LED_NG, OUTPUT);
  digitalWrite(PIN_GPS_LED_OK, LOW);
  digitalWrite(PIN_GPS_LED_NG, LOW);

  Serial.begin(115200);
  Serial.println(F("step5_gps: start"));
  gpsSerial.begin(GPS_BAUD);
  // GPSモジュールが出す文を RMC と GGA の2種類だけに絞る（時刻・測位状態・衛星数・HDOPはこの2つで足りる）。
  // 初期設定のままだと毎秒の文字数が多すぎて、ソフトウェアシリアルの受信が追いつかず取りこぼす。
  // 電源を切ると設定は元に戻るので、起動のたびに送る。D6→RXD が未配線なら何も起きない（害もない）。
  delay(500);
  gpsSerial.print(F("$PMTK314,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0*28\r\n"));

  for (uint8_t i = 0; i < DISP_COUNT; i++) {
    lc.shutdown(i, false);
    lc.setIntensity(i, DISP_BRIGHT);
    lc.clearDisplay(i);
  }
  showDashes(DISP_CLOCK);
}

void loop() {
  static unsigned long lastRxAt = 0;
  while (gpsSerial.available()) {
    char c = gpsSerial.read();
    Serial.write(c);
    gps.encode(c);
    lastRxAt = millis();
  }
  if (gps.time.isUpdated()) syncFromGps();
  // GPSの文を受信している最中は、ソフトウェアシリアルの受信処理にCPUをほぼ取られる。
  // その間に表示の更新など時間のかかる処理をすると受信バッファがあふれて文が欠けるので、
  // 受信が一段落する（GPS_QUIET_MS のあいだ何も届かない）まで後回しにする。
  bool gpsBusy = (millis() - lastRxAt < GPS_QUIET_MS);

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

  static unsigned long lastClockAt = 0;
  if (!gpsBusy && millis() - lastClockAt >= CLOCK_TICK_MS) {
    lastClockAt = millis();
    if (timeSynced) showTime(DISP_CLOCK, currentMsOfDay());
  }

  static unsigned long lastSummaryAt = 0;
  if (!gpsBusy && millis() - lastSummaryAt >= 2000) {
    lastSummaryAt = millis();
    if (gps.satellites.isValid()) showNumber(DISP_LATEST, gps.satellites.value());
    printSummary();
  }
}
