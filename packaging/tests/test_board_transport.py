import base64
from pathlib import Path
import queue
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch, MagicMock
import zlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'board_runtime'))
import serial_worker as worker

class TransportTests(unittest.TestCase):
    def test_port_selection_windows_and_mac(self):
        port=lambda name,vid=0x303A,pid=0x1001: SimpleNamespace(device=name,vid=vid,pid=pid)
        self.assertEqual(worker.candidate_ports([port('COM9'),port('COM3',0x1234)],'win32'),['COM9'])
        self.assertEqual(worker.candidate_ports([port('/dev/tty.usbmodem1'),port('/dev/cu.usbmodem1')],'darwin'),['/dev/cu.usbmodem1'])
    def test_multiple_devices_are_not_selected_arbitrarily(self):
        with patch.object(worker,'candidate_ports',return_value=['COM3','COM4']),patch.object(worker.serial,'Serial') as serial:
            with self.assertRaisesRegex(RuntimeError,'多块'): worker.open_board()
            serial.assert_not_called()
    def test_protocol_header_length_and_crc(self):
        payload=b'\xff\x00\x01'
        result=worker.packet(1,42,payload)
        self.assertEqual(struct.unpack('<4sIII',result[:16]),(b'LPET',1,42,3))
        self.assertEqual(struct.unpack('<I',result[-4:])[0],zlib.crc32(payload))
        with self.assertRaises(ValueError):worker.packet(1,0,b'0'*98305)
    def test_ack_and_touch_events(self):
        link=MagicMock();link.read_until.side_effect=[b'PET_EV',b'ENT {"action":"wave"}\n',b'PET_ACK {"seq":9,"ok":true}\n',b'PET_ACK {"seq":10,"ok":true}\n']
        with patch.object(worker,'emit') as emit:
            self.assertTrue(worker.receive(link,10)['ok'])
            emit.assert_called_once_with({'type':'event','action':'wave'})
    def test_failed_handshake_closes_serial(self):
        link=MagicMock()
        with patch.object(worker.sys,'platform','win32'),patch.object(worker,'candidate_ports',return_value=['COM3']),patch.object(worker.serial,'Serial',return_value=link),patch.object(worker.time,'monotonic',side_effect=[0,4]),patch.object(worker,'receive',side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):worker.open_board()
            link.close.assert_called_once()
            self.assertFalse(link.dtr);self.assertFalse(link.rts)
    def test_reconnect_after_failed_write(self):
        requests=queue.Queue()
        for i in [1,2]: requests.put({'id':i,'kind':1,'data':base64.b64encode(b'jpeg').decode()})
        requests.put(None)
        broken,working=MagicMock(),MagicMock();broken.write.side_effect=OSError('unplugged')
        with patch.object(worker,'requests',requests),patch.object(worker.threading,'Thread'),patch.object(worker,'open_board',side_effect=[broken,working]) as opened,patch.object(worker,'receive',return_value={'ok':True}),patch.object(worker,'emit') as emit,patch.object(worker.time,'sleep'):
            worker.main()
            self.assertEqual(opened.call_count,2)
            broken.close.assert_called_once();working.close.assert_called_once()
            self.assertIn({'type':'result','id':2,'ok':True},[call.args[0] for call in emit.call_args_list])

if __name__=='__main__':unittest.main()
