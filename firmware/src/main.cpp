// Placeholder until phase 1b (docs/plan.md): proves `make flash` works end to end.
#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
  Serial.println("camera-esp firmware placeholder");
  delay(1000);
}
