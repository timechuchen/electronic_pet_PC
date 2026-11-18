import copy
import json
import struct
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from pet.assets import AssetStore, validate_file
from pet.controller import Controller
from app import PetServer

ROOT = Path(__file__).resolve().parents[1] / 'backend'
FBX = b'Kaydara FBX Binary  \x00\x1a\x00' + b'\0' * 40
META = {'kind': 'fbx', 'name': '动作.fbx', 'duration': 2, 'clip': 1, 'clipName': '第二片段', 'mapping': {'hips': 'CustomPelvis', 'head': 'CustomHead'}}

class AssetTests(unittest.TestCase):
    def test_library_persists_and_removal_restores_builtin(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=AssetStore(tmp)
            doc=store.import_file({'kind':'vrm','name':'角色.VRM'}, (ROOT/'Material/兰洛.vrm').read_bytes())
            identifier=doc['models'][0]['id']
            self.assertEqual(doc['selected'],'builtin')
            store.update({'operation':'select','id':identifier})
            self.assertEqual(AssetStore(tmp).snapshot()['selected'],identifier)
            self.assertTrue(store.resolve(identifier+'.vrm').is_file())
            doc=store.update({'operation':'delete','id':identifier})
            self.assertEqual(doc['selected'],'builtin')
            self.assertIsNone(store.resolve(identifier+'.vrm'))
            self.assertEqual(AssetStore(tmp).snapshot(),doc)

    def test_fbx_timeline_pause_loop_removal_and_json_coexist(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=AssetStore(tmp);doc=store.import_file(META,FBX);motion=doc['motions'][0]
            now=[0.0];pet=Controller(lambda:now[0]);pet.set_fbx_actions(doc['motions'])
            pet.command({'type':'settings','speed':2,'loop':True})
            pet.command({'type':'action','name':motion['id']});now[0]=1.25
            self.assertAlmostEqual(pet.snapshot()['body']['time'],.5)
            pet.command({'type':'pause'});now[0]=5
            self.assertAlmostEqual(pet.snapshot()['body']['time'],.5)
            pet.command({'type':'action','name':'smile'})
            self.assertIsNotNone(pet.snapshot()['face'])
            pet.set_custom_actions([])
            self.assertEqual(pet.snapshot()['body']['name'],motion['id'])
            pet.set_fbx_actions([]);self.assertIsNone(pet.snapshot()['body'])
            with self.assertRaises(ValueError):pet.command({'type':'action','name':motion['id']})

    def test_invalid_inputs_preserve_manifest_and_no_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=AssetStore(tmp);store.import_file(META,FBX);before=store.snapshot()
            for change in ({'duration':float('nan')},{'duration':True},{'clip':-1},{'clip':True},{'mapping':{'hips':'same','head':'same'}},{'mapping':{'noBone':'source'}},{'name':'oops.vrm'}):
                with self.assertRaises(ValueError):store.import_file(dict(META,**change),FBX)
                self.assertEqual(store.snapshot(),before)
            for name in ('../../library.json','library.json','/tmp/test','fbx_bad.fbx'):
                self.assertIsNone(store.resolve(name))
            for kind,raw in (('vrm',b'broken'),('fbx',b'not an fbx'),('png',FBX)):
                with self.assertRaises(ValueError):validate_file(kind,raw)
            self.assertEqual(store.snapshot(),before)

    def test_failed_manifest_write_cleans_uploaded_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=AssetStore(tmp)
            with patch('pet.assets.os.replace',side_effect=OSError('disk full')):
                with self.assertRaises(OSError):store.import_file(META,FBX)
            self.assertEqual(store.snapshot()['motions'],[])
            self.assertFalse(list(Path(tmp).glob('*.fbx')))

    def test_vrm_external_resources_are_rejected(self):
        doc={'extensions':{'VRMC_vrm':{}},'images':[{'uri':'https://example.com/texture.png'}]}
        raw=json.dumps(doc).encode();raw+=b' '*((-len(raw))%4)
        glb=b'glTF'+struct.pack('<IIII',2,20+len(raw),len(raw),0x4e4f534a)+raw
        with self.assertRaisesRegex(ValueError,'内嵌'):validate_file('vrm',glb)

class AssetHTTPTests(unittest.TestCase):
    def test_upload_authorization_serving_selection_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            server=PetServer(('127.0.0.1',0),data_dir=tmp,hosted=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base=f'http://127.0.0.1:{server.server_port}'
            def post(route,raw,token=True):
                headers={'X-Pet-Token':server.token} if token else {}
                return urllib.request.urlopen(urllib.request.Request(base+route,data=raw,headers=headers),timeout=5)
            try:
                meta=json.dumps(META).encode();body=struct.pack('<I',len(meta))+meta+FBX
                with self.assertRaises(urllib.error.HTTPError) as error:post('/api/library/upload',body,False)
                self.assertEqual(error.exception.code,403)
                with post('/api/library/upload',body) as response:doc=json.load(response)
                motion=doc['motions'][0]
                with urllib.request.urlopen(base+motion['url']) as response:self.assertEqual(response.read(),FBX)
                self.assertEqual(server.controller.command({'type':'action','name':motion['id']})['body']['duration'],2)
                self.assertEqual(server.state()['asset_revision'],1)
                with post('/api/library',json.dumps({'operation':'delete','id':motion['id']}).encode()):pass
                self.assertIsNone(server.state()['body'])
                with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(base+motion['url'])
                self.assertEqual(AssetStore(Path(tmp)/'assets').snapshot()['motions'],[])
            finally:
                server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
