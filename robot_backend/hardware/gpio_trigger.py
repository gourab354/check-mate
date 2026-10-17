"""
GPIO Button Trigger for Raspberry Pi.
Monitors a physical momentary push-button (e.g. GPIO 17 to GND)
to signal when the human player has finished their move on the physical board.
"""

import time
import logging
import threading
from typing import Callable, Optional
from ..config import HardwareConfig, active_config

logger = logging.getLogger("GPIOTrigger")

class GPIOButtonTrigger:
    def __init__(self, pin: Optional[int] = None, callback: Optional[Callable[[], None]] = None):
        self.pin = pin or active_config.hardware.gpio_button_pin
        self.callback = callback
        self.is_hardware_active = False
        self._last_press_time = 0.0
        self._debounce_sec = 0.35

        self._init_gpio()

    def _init_gpio(self):
        try:
            import RPi.GPIO as GPIO
            GPIO.setmode(GPIO.BCM)
            # Pull-up resistor: button connected between pin and GND
            GPIO.setup(self.pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
            
            def _gpio_event(channel):
                now = time.time()
                if now - self._last_press_time > self._debounce_sec:
                    self._last_press_time = now
                    logger.info(f"[GPIOButtonTrigger] Physical button pressed on GPIO {self.pin}!")
                    if self.callback:
                        threading.Thread(target=self.callback, daemon=True).start()

            GPIO.add_event_detect(self.pin, GPIO.FALLING, callback=_gpio_event, bouncetime=int(self._debounce_sec * 1000))
            self.is_hardware_active = True
            logger.info(f"[GPIOButtonTrigger] Listening for physical button press on BCM GPIO {self.pin}.")
        except Exception as e:
            logger.info(f"[GPIOButtonTrigger] RPi.GPIO not available or not on Pi ({e}). Hardware button disabled; web/software trigger active.")
            self.is_hardware_active = False

    def simulate_press(self):
        """Allows software trigger (e.g. from Web Dashboard) to fire the same event."""
        logger.info("[GPIOButtonTrigger] Software trigger invoked.")
        if self.callback:
            threading.Thread(target=self.callback, daemon=True).start()

    def cleanup(self):
        if self.is_hardware_active:
            try:
                import RPi.GPIO as GPIO
                GPIO.cleanup(self.pin)
            except Exception:
                pass
