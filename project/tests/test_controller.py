import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pet.controller import Controller


class FakeClock:
    def __init__(self): self.now = 0.0
    def __call__(self): return self.now
    def advance(self, seconds): self.now += seconds


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.pet = Controller(self.clock)
        self.pet.command({'type': 'settings', 'auto_blink': False})

    def test_blink_reaches_closed_then_returns_to_neutral(self):
        self.pet.command({'type': 'action', 'name': 'blink'})
        self.clock.advance(.19)
        self.assertAlmostEqual(self.pet.snapshot()['expressions']['blink'], 1)
        self.clock.advance(.20)
        state = self.pet.snapshot()
        self.assertEqual(state['expressions']['blink'], 0)
        self.assertIsNone(state['face'])

    def test_facial_action_does_not_interrupt_wave(self):
        self.pet.command({'type': 'action', 'name': 'wave'})
        self.clock.advance(.8)
        self.pet.command({'type': 'action', 'name': 'blink'})
        self.clock.advance(.19)
        state = self.pet.snapshot()
        self.assertEqual(state['body']['name'], 'wave')
        self.assertAlmostEqual(state['body']['time'], .99)
        self.assertAlmostEqual(state['expressions']['blink'], 1)
        self.assertGreater(state['bones']['rightUpperArm'][2], 0)

    def test_pause_resume_speed_and_loop(self):
        self.pet.command({'type': 'action', 'name': 'nod'})
        self.clock.advance(.5)
        before = self.pet.command({'type': 'pause'})
        self.clock.advance(40)
        self.assertEqual(self.pet.snapshot()['body'], before['body'])
        self.pet.command({'type': 'pause'})
        self.pet.command({'type': 'settings', 'speed': 2, 'loop': True})
        self.clock.advance(1)
        self.assertAlmostEqual(self.pet.snapshot()['body']['time'], .5)
        self.pet.command({'type': 'reset'})
        self.assertIsNone(self.pet.snapshot()['body'])

    def test_switch_body_action_and_reset_bones(self):
        self.pet.command({'type': 'action', 'name': 'wave'})
        self.clock.advance(1)
        self.pet.command({'type': 'action', 'name': 'nod'})
        self.assertEqual(self.pet.snapshot()['bones']['rightUpperArm'], [0, 0, -1.22])
        self.pet.command({'type': 'reset'})
        self.assertFalse(self.pet.snapshot()['paused'])

    def test_all_actions_produce_finite_serializable_frames(self):
        from pet.controller import ACTIONS
        for name in ACTIONS:
            self.pet.command({'type': 'reset'})
            self.pet.command({'type': 'action', 'name': name})
            for _ in range(35):
                self.clock.advance(.1)
                json.dumps(self.pet.snapshot(), allow_nan=False)

    def test_grace_dance_has_distinct_phrases_and_a_soft_smile(self):
        self.pet.command({'type': 'action', 'name': 'grace'})
        self.clock.advance(1.0)
        early = self.pet.snapshot()
        self.assertEqual(early['body']['name'], 'grace')
        self.assertGreater(early['expressions']['happy'], .4)
        self.clock.advance(8.0)
        turn = self.pet.snapshot()
        self.assertGreater(abs(turn['bones']['rightUpperArm'][2] - early['bones']['rightUpperArm'][2]), 1.0)
        self.clock.advance(10.0)
        climax = self.pet.snapshot()
        self.assertGreater(climax['bones']['rightUpperArm'][2], .3)
        self.clock.advance(5.0)
        self.assertIsNone(self.pet.snapshot()['body'])

    def test_grace_choreography_loops_without_a_jump(self):
        from pet import choreography
        self.assertEqual(choreography.sample(0), choreography.sample(24))
        for t in (0, 3.2, 8.0, 12.8, 19.2, 23.9):
            self.assertEqual(set(choreography.sample(t)), set(choreography.BASE))

    def test_invalid_input_is_rejected_without_mutation(self):
        for command in [
            {'type': 'action', 'name': 'unknown'},
            {'type': 'settings', 'speed': float('nan')},
            {'type': 'settings', 'speed': True},
            {'type': 'settings', 'speed': 100},
            {'type': 'settings', 'loop': 'yes'},
            {'type': 'settings', 'speed': 1.5, 'unknown': True},
            {'type': 'action', 'name': 'dance', 'duration': float('inf')},
        ]:
            with self.assertRaises(ValueError): self.pet.command(command)
        self.assertEqual(self.pet.speed, 1)
        self.assertFalse(self.pet.loop)


if __name__ == '__main__': unittest.main()
