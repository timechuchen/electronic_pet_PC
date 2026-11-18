import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from pet.actions import JUMP, ActionStore, sample_action, validate_document
from pet.controller import Controller
from pet.presets import DEFAULT_PRESET, validate_preset

class Clock:
    def __init__(self): self.time = 0
    def __call__(self): return self.time
    def step(self, seconds): self.time += seconds

def document():
    action = copy.deepcopy(JUMP)
    action.update(id='custom_hop', name='轻轻一跳')
    return {'version': 1, 'actions': [action]}

class JumpTests(unittest.TestCase):
    def setUp(self):
        self.clock=Clock();self.pet=Controller(self.clock)
        self.pet.command({'type':'settings','auto_blink':False,'idle_motion':False})

    def test_crouch_liftoff_landing_and_no_residual_offset(self):
        self.pet.command({'type':'action','name':'jump'})
        self.assertEqual(self.pet.snapshot()['root_y'],0)
        self.clock.step(.3);self.assertLess(self.pet.snapshot()['root_y'],0)
        self.clock.step(.5);state=self.pet.snapshot()
        self.assertAlmostEqual(state['root_y'],.15)
        self.assertGreater(state['bones']['leftLowerLeg'][0],0)
        self.clock.step(1.01);state=self.pet.snapshot()
        self.assertIsNone(state['body']);self.assertEqual(state['root_y'],0)
        self.assertNotIn('leftLowerLeg',state['bones'])

    def test_pause_speed_loop_and_facial_layer(self):
        self.pet.command({'type':'settings','speed':2,'loop':True})
        self.pet.command({'type':'action','name':'jump'})
        self.clock.step(.4);before=self.pet.command({'type':'pause'})
        self.clock.step(5);self.assertEqual(self.pet.snapshot()['root_y'],before['root_y'])
        self.pet.command({'type':'pause'})
        self.pet.command({'type':'action','name':'blink'})
        self.clock.step(.095);state=self.pet.snapshot()
        self.assertEqual(state['body']['name'],'jump');self.assertAlmostEqual(state['expressions']['blink'],1)
        self.clock.step(.91);state=self.pet.snapshot()
        self.assertEqual(state['body']['name'],'jump');self.assertLess(state['body']['time'],1.8)

    def test_switch_and_reset_restore_ground(self):
        for target in ({'type':'action','name':'wave'}, {'type':'reset'}):
            self.pet.command({'type':'action','name':'jump'});self.clock.step(.8)
            self.assertGreater(self.pet.snapshot()['root_y'],0)
            self.pet.command(target);self.assertEqual(self.pet.snapshot()['root_y'],0)

    def test_jump_can_be_saved_as_idle_or_music_response(self):
        profile=validate_preset(dict(DEFAULT_PRESET,idle_action='jump',music_action='jump'))
        self.pet.apply_profile(profile);self.pet.snapshot();self.clock.step(.8)
        self.assertEqual(self.pet.snapshot()['body']['source'],'idle')
        self.assertGreater(self.pet.snapshot()['root_y'],0)

    def test_idle_jump_starts_on_ground_after_selection_and_manual_action(self):
        self.clock.step(7.4)
        self.pet.apply_profile(dict(DEFAULT_PRESET,idle_action='jump'))
        self.assertEqual(self.pet.snapshot()['root_y'],0)
        self.clock.step(.8);self.assertGreater(self.pet.snapshot()['root_y'],0)
        self.pet.command({'type':'action','name':'wave'})
        self.clock.step(3.1)
        state=self.pet.snapshot()
        self.assertEqual(state['body']['name'],'jump')
        self.assertEqual(state['body']['time'],0)
        self.assertEqual(state['root_y'],0)

class LibraryTests(unittest.TestCase):
    def test_roundtrip_update_delete_and_active_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'actions.json';store=ActionStore(path)
            doc=store.update({'operation':'import','document':document()})
            self.assertEqual(ActionStore(path).snapshot(),doc)
            clock=Clock();pet=Controller(clock);pet.set_custom_actions(doc['actions'])
            pet.command({'type':'action','name':'custom_hop'});clock.step(.8)
            self.assertGreater(pet.snapshot()['root_y'],0)
            updated=document();updated['actions'][0]['name']='更新的动作'
            self.assertEqual(len(store.update({'operation':'import','document':updated})['actions']),1)
            doc=store.update({'operation':'delete','id':'custom_hop'});pet.set_custom_actions(doc['actions'])
            self.assertIsNone(pet.snapshot()['body']);self.assertEqual(pet.snapshot()['root_y'],0)
            self.assertEqual(ActionStore(path).snapshot()['actions'],[])

    def test_rejected_import_keeps_memory_and_disk_unchanged(self):
        mutations=[
            lambda d:d.update(version=True),
            lambda d:d['actions'][0].update(id='jump'),
            lambda d:d['actions'][0].update(duration=float('nan')),
            lambda d:d['actions'][0]['keyframes'][1].update(time=0),
            lambda d:d['actions'][0]['keyframes'][0].update(lift=.1),
            lambda d:d['actions'][0]['keyframes'][1].update(bones={'invalidBone':[0,0,0]}),
            lambda d:d['actions'][0]['keyframes'][1].update(bones={'head':[True,0,0]}),
            lambda d:d['actions'][0]['keyframes'][1].update(lift=.9),
            lambda d:d['actions'][0].update(script='example'),
            lambda d:d['actions'].append(copy.deepcopy(d['actions'][0])),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'actions.json';store=ActionStore(path)
            store.update({'operation':'import','document':document()});before=path.read_bytes()
            for mutate in mutations:
                bad=document();mutate(bad)
                with self.assertRaises(ValueError):store.update({'operation':'import','document':bad})
                self.assertEqual(path.read_bytes(),before);self.assertEqual(store.snapshot(),document())

    def test_example_and_interpolation_boundaries(self):
        example=Path(__file__).resolve().parents[1]/'backend/web/actions.example.json'
        validate_document(json.loads(example.read_text()))
        action=document()['actions'][0]
        for i in range(181):
            bones,lift=sample_action(action,i/100)
            json.dumps({'bones':bones,'lift':lift},allow_nan=False)
        for at in [0,1.8,2]:
            bones,lift=sample_action(action,at)
            self.assertEqual(lift,0);self.assertTrue(all(not any(v) for v in bones.values()))

class GraceTests(unittest.TestCase):
    def setUp(self):
        self.clock=Clock();self.pet=Controller(self.clock)
        self.pet.command({'type':'settings','auto_blink':False,'idle_motion':False})

    def test_grace_plays_through_its_phrases_and_smiles(self):
        self.pet.command({'type':'action','name':'grace'})
        self.clock.step(1.0)
        early=self.pet.snapshot()
        self.assertEqual(early['body']['name'],'grace')
        self.assertEqual(early['body']['label'],'轻舞')
        self.assertGreater(early['expressions']['happy'],.4)
        self.clock.step(8.0)
        turn=self.pet.snapshot()
        self.assertGreater(abs(turn['bones']['rightUpperArm'][2]-early['bones']['rightUpperArm'][2]),1.0)
        self.clock.step(15.0)
        self.assertIsNone(self.pet.snapshot()['body'])

    def test_grace_can_be_an_idle_or_music_response(self):
        profile=validate_preset(dict(DEFAULT_PRESET,idle_action='grace',music_action='grace'))
        self.pet.apply_profile(profile)
        self.clock.step(.5)
        state=self.pet.snapshot()
        self.assertEqual(state['body']['name'],'grace')
        self.assertEqual(state['body']['source'],'idle')
        self.assertGreater(state['expressions']['happy'],.4)

if __name__=='__main__':unittest.main()
