import { describe,it,expect,vi } from 'vitest';
import {ScenaroSession} from './ScenaroSession';
import type {Transport,TransportDataMessage} from './transport';
import type {ScenaroClient} from '../client';

describe('session return and mode-switch protocol',()=>{
 it('suppresses a mode-switch return only for that start and carries explicit controls',async()=>{
  let receive:(m:TransportDataMessage)=>void=()=>{};
  const publish=vi.fn().mockResolvedValue(undefined);
  const transport:Transport={connect:vi.fn().mockResolvedValue(undefined),disconnect:vi.fn().mockResolvedValue(undefined),setMicrophoneEnabled:vi.fn().mockResolvedValue(undefined),sendText:vi.fn().mockResolvedValue(undefined),publishData:publish,registerToolHandler:()=>{},unregisterToolHandler:()=>{},onData:h=>{receive=h;return()=>{}},onConnectionStateChange:()=>()=>{},onAgentPresenceChange:()=>()=>{},onAgentStateChange:()=>()=>{},getEngineHandle:()=>null};
  const client={identifyUser:vi.fn().mockResolvedValue({}),startSession:vi.fn().mockResolvedValue({livekit_url:'wss://test',livekit_token:'test'}),request:vi.fn()} as unknown as ScenaroClient;
  const session=new ScenaroSession({client,transport});
  const config=()=>receive({topic:'config',payload:new TextEncoder().encode(JSON.stringify({conversation_id:'same',features:[],collections:[]}))});
  await session.start({scenario:'test',inputMode:'text',microphone:false,resumeConversationId:'same',suppressRecap:true});config();
  expect(publish.mock.calls.find(c=>c[0]==='config_ack')?.[1]).toMatchObject({suppress_recap:true});
  await session.setSessionControl({discreteMode:false,exchangeMode:'text',handoff:'mode_switch'});
  expect(publish.mock.calls.find(c=>c[0]==='session:control')?.[1]).toMatchObject({discrete_mode:false,exchange_mode:'text',handoff:'mode_switch'});
  await session.end();publish.mockClear();
  await session.start({scenario:'test',inputMode:'text',microphone:false,resumeConversationId:'same'});config();
  expect(publish.mock.calls.find(c=>c[0]==='config_ack')?.[1]).not.toHaveProperty('suppress_recap');
  session.destroy();
 });
});
