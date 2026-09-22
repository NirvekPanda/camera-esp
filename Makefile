PIO ?= pio
# PlatformIO's Python ships pyserial, which hwtest needs.
PIO_PYTHON ?= $(HOME)/.platformio/penv/bin/python
PORT ?=
# Device UI (firmware/lib/ui): same flags for native and WASM so both render identical pixels.
UI_SRC := $(wildcard firmware/lib/ui/src/*.cpp)
UI_FLAGS := -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -Werror

.DEFAULT_GOAL := help
.PHONY: help build flash upload monitor hwtest uitest ui-preview wasm web stop restart check

help: ## Show this help
	@echo "Usage: make <target> [PORT=/dev/cu.usbmodemXXXX]"
	@echo
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  \033[1m%-9s\033[0m %s\n", $$1, $$2 }'

build: ## Build the firmware (also exports web/public/firmware/ for WebSerial flashing)
	$(PIO) run -d firmware

flash: ## Build and flash the firmware (PORT auto-detected if omitted)
	$(PIO) run -d firmware -t upload $(if $(PORT),--upload-port $(PORT))

upload: flash ## Same as flash

hwtest: ## Test the flashed camera over USB: frames, every resolution, mirror, SD photos
	$(PIO_PYTHON) firmware/tools/hwtest.py $(PORT)

uitest: ## Native tests for the device UI (framebuffer, ST7789 driver/emulator, screens)
	@mkdir -p build
	$(CXX) $(UI_FLAGS) $(UI_SRC) firmware/test_ui/*.cpp -o build/uitest
	./build/uitest

ui-preview: ## Print the device UI screens in the terminal (truecolor)
	@mkdir -p build
	$(CXX) $(UI_FLAGS) $(UI_SRC) firmware/tools/ui_preview.cpp -o build/ui-preview
	./build/ui-preview

wasm: ## Build the device UI emulator for the site: web/public/wasm/device-ui.wasm
	@mkdir -p web/public/wasm
	emcc $(UI_FLAGS) -Oz -fno-rtti -fno-exceptions --no-entry -sSTANDALONE_WASM -sINITIAL_MEMORY=4mb -sSTACK_SIZE=256kb -sALLOW_MEMORY_GROWTH=0 \
	  $(UI_SRC) firmware/test_ui/golden.cpp firmware/wasm/device_ui.cpp -o web/public/wasm/device-ui.wasm

monitor: ## Open the serial monitor (shows raw protocol bytes while streaming)
	$(PIO) device monitor -d firmware $(if $(PORT),--port $(PORT))

web: ## Deploy/relaunch the site on nginx port 8888 (./start.sh)
	./start.sh

stop: ## Stop the site and free port 8888 (./start.sh stop)
	./start.sh stop

restart: ## Restart the site without pulling (./start.sh restart)
	./start.sh restart

check: uitest ## Device UI tests, then web lint, types, unit and integration tests
	cd web && npm run check
