import * as stream from 'stream';
import { DebugConfiguration } from './debug-configuration';
import { IDisposable, MaybePromise, IJSONSchema, IJSONSchemaSnippet } from '@ali/ide-core-common';
import { DebugEditor } from './debug-editor';

export const DebugAdapterSession = Symbol('DebugAdapterSession');

export interface DebugAdapterSession {
  id: string;
  start(channel: any): Promise<void>;
  stop(): Promise<void>;
}

export const DebugAdapterSessionFactory = Symbol('DebugAdapterSessionFactory');

export interface DebugAdapterSessionFactory {
  get(sessionId: string, communicationProvider: DebugStreamConnection): DebugAdapterSession;
}

export interface DebugAdapterSpawnExecutable {
  command: string;
  args?: string[];
}

export interface DebugAdapterForkExecutable {
  modulePath: string;
  args?: string[];
}

/**
 * 可执行的调试适配器类型
 * 用于实例化调试适配器的参数
 *
 * 在Launch适配器进程的情况下，参数包含命令和参数。例如：
 * {'command' : 'COMMAND_TO_LAUNCH_DEBUG_ADAPTER', args : [ { 'arg1', 'arg2' } ] }
 *
 * 在Fork适配器进程的情况下，包含要转换的modulePath。例如：
 * {'modulePath' : 'NODE_COMMAND_TO_LAUNCH_DEBUG_ADAPTER', args : [ { 'arg1', 'arg2' } ] }
 */
export type DebugAdapterExecutable = DebugAdapterSpawnExecutable | DebugAdapterForkExecutable;

/**
 * 与调试进程的通讯渠道
 */
export interface DebugStreamConnection extends IDisposable {
  output: stream.Readable;
  input: stream.Writable;
  // TODO: 处理close及error
}

export const DebugAdapterFactory = Symbol('DebugAdapterFactory');

export interface DebugAdapterFactory {
  start(executable: DebugAdapterExecutable): DebugStreamConnection;
  connect(debugServerPort: number): DebugStreamConnection;
}

export const DebugAdapterContribution = Symbol('DebugAdapterContribution');

export interface DebugAdapterContribution {
  /**
   * The debug type. Should be a unique value among all debug adapters.
   */
  readonly type: string;

  readonly label?: MaybePromise<string | undefined>;

  readonly languages?: MaybePromise<string[] | undefined>;

  /**
   * The [debug adapter session](#DebugAdapterSession) factory.
   * If a default implementation of the debug adapter session does not
   * fit all needs it is possible to provide its own implementation using
   * this factory. But it is strongly recommended to extend the default
   * implementation if so.
   */
  debugAdapterSessionFactory?: DebugAdapterSessionFactory;

  /**
   * @returns The contributed configuration schema for this debug type.
   */
  getSchemaAttributes?(): MaybePromise<IJSONSchema[]>;

  getConfigurationSnippets?(): MaybePromise<IJSONSchemaSnippet[]>;

  /**
   * Provides a [debug adapter executable](#DebugAdapterExecutable)
   * based on [debug configuration](#DebugConfiguration) to launch a new debug adapter
   * or to connect to existed one.
   * @param config The resolved [debug configuration](#DebugConfiguration).
   * @returns The [debug adapter executable](#DebugAdapterExecutable).
   */
  provideDebugAdapterExecutable?(config: DebugConfiguration): MaybePromise<DebugAdapterExecutable | undefined>;

  /**
   * Provides initial [debug configuration](#DebugConfiguration).
   * @returns An array of [debug configurations](#DebugConfiguration).
   */
  provideDebugConfigurations?(workspaceFolderUri?: string): MaybePromise<DebugConfiguration[]>;

  /**
   * Resolves a [debug configuration](#DebugConfiguration) by filling in missing values
   * or by adding/changing/removing attributes.
   * @param config The [debug configuration](#DebugConfiguration) to resolve.
   * @returns The resolved debug configuration.
   */
  resolveDebugConfiguration?(config: DebugConfiguration, workspaceFolderUri?: string): MaybePromise<DebugConfiguration | undefined>;
}

export const DebugModelFactory = Symbol('DebugModelFactory');
export type DebugModelFactory = (editor: DebugEditor) => IDebugModel;

export const IDebugModel = Symbol('IDebugModel');
export interface IDebugModel extends IDisposable {
  [key: string]: any;
}
