#pragma once

#include <Arduino.h>

// The perfboard wiring (xiao_perfboard_layout_v2.drawio) as GPIOs. D0..D10 are the XIAO's edge
// pads, mapped by the board variant; D11 is a back pad the variant doesn't name (GPIO42).
// The camera and the microSD slot are on the Sense board's own pins (camera_pins.h).

// 5-way switch: its common leg goes to GND, so a direction reads LOW while held (INPUT_PULLUP).
// The diagram's direction labels are a guess and need checking with a multimeter (its legend says
// so); swapping them here is the whole fix.
constexpr int SW_UP_GPIO = D2;      // 3
constexpr int SW_CENTER_GPIO = D3;  // 4
constexpr int SW_DOWN_GPIO = D4;    // 5
constexpr int SW_LEFT_GPIO = D5;    // 6
constexpr int SW_RIGHT_GPIO = D6;   // 43, UART0 TX: free because the console is USB CDC

// A and B, and the shutter on the back pad. Also to GND, also active LOW.
constexpr int BTN_A_GPIO = D1;         // 2
constexpr int BTN_B_GPIO = D0;         // 1
constexpr int BTN_SHUTTER_GPIO = 42;   // D11

// ST7789 display. SCL/SDA are the SPI bus the microSD card also uses (SCK GPIO7, MOSI GPIO9).
// RES is strapped to 3V3 and CS to GND on the board, so the panel is always selected: SD traffic
// reaches it as commands. Give CS its own GPIO before driving both.
constexpr int SPI_MISO_GPIO = D9;   // 8, the microSD card's; the panel is write-only
constexpr int TFT_SCK_GPIO = D8;    // 7
constexpr int TFT_MOSI_GPIO = D10;  // 9
constexpr int TFT_DC_GPIO = D7;     // 44, UART0 RX
constexpr int TFT_CS_GPIO = -1;     // tied to GND
constexpr int TFT_RST_GPIO = -1;    // tied to 3V3
// BLK (backlight) is left unconnected: the module drives it on by default.
