import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from pet.controller import Controller

class Reactions(unittest.TestCase):
    def setUp(self):
        self.time = 0
        self.pet = Controller(lambda: self.time)

    def react(self, **data):
        return self.pet.ai_reaction(dict(action='nod', expression='smile', revision=self.pet.interaction_revision, **data))

    def test_ai_actions_do_not_inherit_manual_loop(self):
        self.pet.command({'type': 'settings', 'loop': True})
        self.react(); state = self.pet.snapshot()
        self.assertEqual(state['body']['source'], 'ai')
        self.assertEqual(state['face']['name'], 'smile')
        self.time += 4
        self.assertIsNone(self.pet.snapshot()['body'])
        self.assertIsNone(self.pet.snapshot()['face'])
        self.assertTrue(self.pet.loop)

    def test_new_user_command_invalidates_pending_response(self):
        revision = self.pet.interaction_revision
        self.pet.command({'type': 'reset'})
        self.assertFalse(self.pet.ai_reaction({'action':'wave','expression':'smile','revision':revision})['applied'])

    def test_manual_action_pause_and_tracking_are_respected(self):
        self.pet.command({'type': 'action', 'name': 'wave'})
        self.react(); self.assertEqual(self.pet.snapshot()['body']['name'], 'wave')
        self.pet.command({'type':'pause'})
        self.assertFalse(self.react()['applied']); self.assertTrue(self.pet.paused)
        self.pet.command({'type':'reset'})
        self.pet.tracking.feed({'source':'test','sequence':1,'active':True,'bones':{},'expressions':{}})
        self.assertFalse(self.react()['applied'])

    def test_untrusted_actions_rejected_before_mutation(self):
        for action in ('custom_unknown', 'pause', {'bad': 1}):
            with self.assertRaises(ValueError):
                self.pet.ai_reaction({'action':action,'expression':'smile','revision':0})
        self.assertIsNone(self.pet.snapshot()['body'])

if __name__ == '__main__': unittest.main()
