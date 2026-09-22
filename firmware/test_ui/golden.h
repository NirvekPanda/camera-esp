#pragma once

#include <stdint.h>

// A scripted session run by the native tests and, through the WASM build, by the browser test
// (web/e2e/device.spec.ts). Both must produce EXPECTED_HASH: native == WASM, bit for bit.
namespace golden {

// Combined hash of every frame in the script. Only update it after checking the frames with
// `make ui-preview`; a change means the pixels changed.
constexpr uint32_t EXPECTED_HASH = 0xeeb69ae3;

uint32_t run();

}  // namespace golden
