import copy
import json
import tempfile
import unittest
from pathlib import Path
from pet.controller import Controller
from pet.presets import PresetStore, DEFAULT_DOCUMENT, DEFAULT_PRESET
from pet.music import MusicGate


class Clock:
    def __init__(self): self.t = 0.
    def __call__(self): return self.t
    def step(self, dt): self.t += dt


class PresetTests(unittest.TestCase):
    def test_save_select_and_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'presets.json'
            store = PresetStore(path)
            preset = dict(DEFAULT_PRESET, id='custom', name='我的待机', idle_action='wave')
            store.update({'operation':'save', 'preset':preset})
            self.assertEqual(PresetStore(path).selected(),preset)
            store.update({'operation':'select','id':'cheerful'})
            self.assertEqual(PresetStore(path).selected()['idle_action'],'sway')

    def test_grace_can_be_an_idle_and_music_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'presets.json'; store = PresetStore(path)
            preset = dict(DEFAULT_PRESET, id='dancer', name='轻舞陪伴', idle_action='grace', music_action='grace')
            store.update({'operation': 'save', 'preset': preset})
            self.assertEqual(PresetStore(path).selected()['idle_action'], 'grace')
            self.assertEqual(PresetStore(path).selected()['music_action'], 'grace')

    def test_invalid_import_never_changes_saved_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'presets.json';store = PresetStore(path)
            store.update({'operation':'import','document':DEFAULT_DOCUMENT})
            original = path.read_bytes()
            bad = copy.deepcopy(DEFAULT_DOCUMENT);bad['presets'][0]['speed'] = float('nan')
            with self.assertRaises(ValueError): store.update({'operation':'import','document':bad})
            self.assertEqual(original,path.read_bytes())
            bad = copy.deepcopy(DEFAULT_DOCUMENT);bad['presets'][0]['command']='rm -rf'
            with self.assertRaises(ValueError): store.update({'operation':'import','document':bad})
            self.assertEqual(original,path.read_bytes())

    def test_manual_action_returns_to_selected_idle(self):
        clock=Clock();pet=Controller(clock)
        pet.apply_profile(dict(DEFAULT_PRESET,idle_action='wave'))
        self.assertEqual(pet.snapshot()['body']['source'],'idle')
        pet.command({'type':'action','name':'nod'});clock.step(.5)
        self.assertEqual(pet.snapshot()['body']['name'],'nod')
        clock.step(2)
        self.assertEqual(pet.snapshot()['body']['name'],'wave')
        self.assertEqual(pet.snapshot()['body']['source'],'idle')


class MusicTests(unittest.TestCase):
    def setUp(self):
        self.clock=Clock();self.gate=MusicGate(self.clock);self.gate.enable(True)
    def feed(self,score,level=.1,dt=.5):
        self.clock.step(dt);self.gate.feed({'score':score,'level':level},DEFAULT_PRESET)
    def test_music_start_silence_stop_and_spike_rejection(self):
        self.feed(.9);self.feed(0);self.assertFalse(self.gate.active)
        for _ in range(4):self.feed(.9)
        self.assertTrue(self.gate.active)
        for _ in range(7):self.feed(0,0)
        self.assertFalse(self.gate.active)
    def test_stale_or_disabled_audio_cannot_keep_dancing(self):
        for _ in range(4):self.feed(.9)
        self.clock.step(4);self.assertFalse(self.gate.snapshot()['active'])
        self.gate.enable(False);self.feed(.99);self.assertFalse(self.gate.active)
    def test_classifier_speech_and_silence_do_not_trigger(self):
        for _ in range(12):self.feed(.1,.5)
        self.assertFalse(self.gate.active)
        for _ in range(12):self.feed(.99,0)
        self.assertFalse(self.gate.active)
    def test_music_manual_priority_and_idle_fallback(self):
        pet=Controller(self.clock);pet.music.enable(True)
        for _ in range(4):
            self.clock.step(.5);pet.music.feed({'score':.9,'level':.1},pet.profile)
        self.assertEqual(pet.snapshot()['body']['source'],'music')
        pet.command({'type':'action','name':'wave'})
        self.assertEqual(pet.snapshot()['body']['name'],'wave')
        pet.music.enable(False);self.clock.step(4)
        self.assertIsNone(pet.snapshot()['body'])
    def test_invalid_numbers_and_error(self):
        with self.assertRaises(ValueError):self.gate.feed({'score':float('nan')},DEFAULT_PRESET)
        self.gate.feed({'status':'error','message':'permission denied'},DEFAULT_PRESET)
        self.assertFalse(self.gate.enabled);self.assertEqual(self.gate.status,'error')

class RelayTests(unittest.TestCase):
    def test_pose_expiry_stop_order_and_validation(self):
        from pet.tracking import PoseRelay
        clock=Clock();relay=PoseRelay(clock)
        sample={'source':'test','sequence':1,'active':True,'bones':{'rightUpperArm':[0,0,0,1]},'expressions':{'happy':.5}}
        relay.feed(sample);self.assertIsNotNone(relay.snapshot())
        relay.feed({'source':'test','sequence':3,'active':False})
        relay.feed(dict(sample,sequence=2));self.assertIsNone(relay.snapshot())
        relay.feed(dict(sample,sequence=4));clock.step(1.3);self.assertIsNone(relay.snapshot())
        with self.assertRaises(ValueError):relay.feed(dict(sample,sequence=5,bones={'rightUpperArm':[0,0,0,0]}))
