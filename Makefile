PIO ?= pio
# PlatformIO's Python ships pyserial, which hwtest needs.
PIO_PYTHON ?= $(HOME)/.platformio/penv/bin/python
PORT ?=

.DEFAULT_GOAL := help
.PHONY: help build flash upload monitor hwtest web stop restart check

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

monitor: ## Open the serial monitor (shows raw protocol bytes while streaming)
	$(PIO) device monitor -d firmware $(if $(PORT),--port $(PORT))

web: ## Deploy/relaunch the site on nginx port 8888 (./start.sh)
	./start.sh

stop: ## Stop the site and free port 8888 (./start.sh stop)
	./start.sh stop

restart: ## Restart the site without pulling (./start.sh restart)
	./start.sh restart

check: ## Web lint, types, unit and integration tests
	cd web && npm run check
