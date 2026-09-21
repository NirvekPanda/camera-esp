# make flash [PORT=/dev/cu.usbmodemXXXX]   build + flash firmware (port auto-detected if omitted)
# make monitor [PORT=...]                  serial monitor
# make web | stop | restart                ./start.sh (deploy site to nginx on port 8888)
# make check                               web lint, types, unit and integration tests

PIO ?= pio
PORT ?=

.PHONY: build flash monitor web stop restart check

build:
	$(PIO) run -d firmware

flash:
	$(PIO) run -d firmware -t upload $(if $(PORT),--upload-port $(PORT))

monitor:
	$(PIO) device monitor -d firmware $(if $(PORT),--port $(PORT))

web:
	./start.sh

stop:
	./start.sh stop

restart:
	./start.sh restart

check:
	cd web && npm run check
