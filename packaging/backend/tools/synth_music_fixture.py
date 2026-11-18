"""Generate a short original melody for offline music-classifier verification."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 22050
beat = 60 / 110
melody = [261.63, 329.63, 392.00, 523.25, 440.0, 392.0, 329.63, 293.66] * 2
random.seed(1)
output = Path('/tmp/lanluo-music-test.wav')
with wave.open(str(output), 'wb') as wav:
    wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    samples = bytearray()
    for i in range(int(rate * beat * len(melody))):
        t = i / rate; note = int(t / beat); phase = t % beat
        f = melody[note]
        env = (1 - math.exp(-phase * 90)) * math.exp(-phase * 5)
        piano = sum(math.sin(2*math.pi*f*h*t) / h**1.6 for h in range(1,6)) * env
        bass = math.sin(2*math.pi*130.81*t) * math.exp(-phase*4)
        kick = math.sin(2*math.pi*(55*phase + 2*(1-math.exp(-phase*40)))) * math.exp(-phase*24)
        hat = random.uniform(-1,1) * math.exp(-(t % (beat/2))*90)
        value = .35*piano + .16*bass + .22*kick + .06*hat
        samples += struct.pack('<h', int(max(-.95,min(.95,value))*32767))
    wav.writeframes(samples)
print(output)
