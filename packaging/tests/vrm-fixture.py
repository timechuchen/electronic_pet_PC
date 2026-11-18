"""Generate an original, minimal rigid VRM 1.0 humanoid for import regression tests."""
import json
import struct
import sys
from pathlib import Path

def create(path):
    nodes=[];bones={}
    def bone(name,position,parent=None):
        index=len(nodes);bones[name]=index;nodes.append({'name':name,'translation':position,'children':[]})
        if parent is not None:nodes[bones[parent]]['children'].append(index)
        return index
    bone('hips',[0,1,0]);bone('spine',[0,.2,0],'hips');bone('head',[0,.45,0],'spine')
    for side,sign in [('left',1),('right',-1)]:
        bone(side+'UpperArm',[sign*.22,.28,0],'spine')
        bone(side+'LowerArm',[sign*.3,0,0],side+'UpperArm')
        bone(side+'Hand',[sign*.25,0,0],side+'LowerArm')
        bone(side+'UpperLeg',[sign*.1,-.1,0],'hips')
        bone(side+'LowerLeg',[0,-.4,0],side+'UpperLeg')
        bone(side+'Foot',[0,-.4,.06],side+'LowerLeg')
    for name,index in bones.items():
        size=[.18,.18,.18] if name=='head' else [.09,.12,.09]
        nodes[index]['children'].append(len(nodes))
        nodes.append({'name':name+'Shape','mesh':0,'scale':size})
    vertices=[-.5,-.5,-.5,.5,-.5,-.5,.5,.5,-.5,-.5,.5,-.5,-.5,-.5,.5,.5,-.5,.5,.5,.5,.5,-.5,.5,.5]
    indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3]
    binary=struct.pack('<24f',*vertices)+struct.pack('<36H',*indices)
    doc={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,
         'buffers':[{'byteLength':len(binary)}],
         'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':96,'target':34962},{'buffer':0,'byteOffset':96,'byteLength':72,'target':34963}],
         'accessors':[{'bufferView':0,'componentType':5126,'count':8,'type':'VEC3','min':[-.5,-.5,-.5],'max':[.5,.5,.5]},{'bufferView':1,'componentType':5123,'count':36,'type':'SCALAR'}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1,'material':0}]}],
         'materials':[{'pbrMetallicRoughness':{'baseColorFactor':[.3,.6,.9,1],'metallicFactor':0,'roughnessFactor':.8}}],
         'extensionsUsed':['VRMC_vrm'],'extensions':{'VRMC_vrm':{'specVersion':'1.0','meta':{'name':'测试人形','authors':['Project regression tests'],'licenseUrl':'https://vrm.dev/licenses/1.0/'},'humanoid':{'humanBones':{k:{'node':v} for k,v in bones.items()}}}}}
    raw=json.dumps(doc).encode();raw+=b' '*((-len(raw))%4)
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(b'glTF'+struct.pack('<II',2,28+len(raw)+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary)

if __name__=='__main__':create(sys.argv[1])
