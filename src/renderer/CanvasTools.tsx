import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
/** Upstream 0.18 builds .App-toolbar as Island > Stack.Row; portal is version-scoped, never reparents React-owned nodes. */
export function CanvasTools({host,onModule,onFormula,onTitle,hasModule}:{host:HTMLElement|null;onModule:()=>void;onFormula:()=>void;onTitle:()=>void;hasModule:boolean}){
 const [target,setTarget]=useState<Element|null>(null);
 useEffect(()=>{if(!host)return;const sync=()=>setTarget(host.querySelector('.App-toolbar > .Stack_horizontal')??host.querySelector('.App-toolbar'));sync();const observer=new MutationObserver(sync);observer.observe(host,{childList:true,subtree:true});return()=>observer.disconnect()},[host]);
 const controls=<div className="paper-native-tools" role="group" aria-label="模块与公式"><span className="paper-tool-divider"/><button title="将选中形状设为可展开模块" onClick={onModule}>▣ 模块</button><button title="输入或编辑 LaTeX 公式" onClick={onFormula}>ƒx 公式</button>{hasModule&&<button title="编辑模块标题" onClick={onTitle}>标题</button>}</div>;
 return target?createPortal(controls,target):<div className="paper-tools-fallback">{controls}</div>;
}
