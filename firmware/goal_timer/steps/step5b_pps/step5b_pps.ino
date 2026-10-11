/*
 * step5b_pps.ino — ステップ5b：GPSの1PPS信号（1秒ごとのパルス）を使った正確な時刻合わせの確認
 *
 * step5_gps で分かったこと：GPSの文（NMEA）は、その秒が始まってから0.25〜0.4秒ほど遅れて届く。
 * 文が届いた瞬間を「その秒ちょうど」として時計を合わせると、時計がその分だけ遅れる。
 *
 * そこで、秒の始まりちょうどに出る1PPS信号をD3（割り込み）で受け、その瞬間を基準にする。
 * 文は「いまのパルスが何時何分何秒か」を知るためだけに使う。
 * 1PPSが来ていない間（未配線・測位前）は、従来どおり文が届いた瞬間で合わせる（遅れたまま）。
 *
 * シリアルモニタ（115200bps）の要約行に pps=（受けたパルスの数）と mode=（pps／nmea）が出る。
 * 表示器②の右端にも、1PPSで合わせているときは「1」、文だけで合わせているときは「0」を出す。
 *
 * 配線：step5_gps に加えて、GPSモジュールの 1PPS → D3
 *
 * 合格条件：pps= が毎秒1ずつ増え、mode=pps になり、表示器③の秒の変わり目が正確な時計と合う。
 */

#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>
#include <LedControl.h>

const uint8_t PIN_GPS_PPS    = 3;  // GPSモジュールの1PPS（秒の始まりのパルス。AE-GYSFDMAXBでは秒の始まりでLOWに下がる＝実測）
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
const unsigned long PPS_MATCH_MS  = 950;  // 文が届いたとき、これ以内に来ていたパルスを「その文の秒の始まり」とみなす
const unsigned long PPS_LOST_MS   = 3000; // これだけパルスで合わせられなければ、文だけで合わせる方式に戻す
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

volatile unsigned long ppsAtMillis = 0; // 最後のパルスが来た瞬間の millis()
volatile uint16_t ppsCount = 0;         // 受けたパルスの数
bool ppsSynced = false;                 // true＝1PPSで合わせている
unsigned long lastPpsSyncAt = 0;

void onPpsInterrupt() {
  ppsAtMillis = millis();
  ppsCount++;
}

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
  ms = (ms + TZ_OFFSET_MS) % DAY_MS;

  unsigned long now = millis();
  noInterrupts();
  unsigned long ppsAt = ppsAtMillis;
  uint16_t count = ppsCount;
  interrupts();

  if (count > 0 && now - ppsAt < PPS_MATCH_MS) {
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
  noInterrupts();
  uint16_t count = ppsCount;
  interrupts();
  Serial.print(F(" pps="));
  Serial.print(count);
  Serial.print(F(" mode="));
  Serial.print(ppsSynced ? F("pps") : F("nmea"));
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
  Serial.println(F("step5b_pps: start"));
  pinMode(PIN_GPS_PPS, INPUT_PULLUP); // 未配線のときにノイズで誤動作しないよう、内蔵プルアップでHIGHに固定しておく
  attachInterrupt(digitalPinToInterrupt(PIN_GPS_PPS), onPpsInterrupt, FALLING);
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
    showNumber(DISP_PREV, ppsSynced ? 1 : 0);
    printSummary();
  }
}
