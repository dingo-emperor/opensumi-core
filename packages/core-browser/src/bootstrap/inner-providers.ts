import { Provider, Injector } from '@ali/common-di';
import {
  IEventBus,
  EventBusImpl,
  CommandService,
  CommandRegistryImpl,
  CommandContribution,
  MenuContribution,
  createContributionProvider,
  CommandServiceImpl,
  CommandRegistry,
  ILogger,
  IElectronMainMenuService,
} from '@ali/ide-core-common';
import { ClientAppContribution } from './app';
import { ClientAppStateService } from '../services/clientapp-status-service';

import { KeyboardNativeLayoutService, KeyboardLayoutChangeNotifierService } from '@ali/ide-core-common/lib/keyboard/keyboard-layout-provider';

import { KeybindingContribution, KeybindingService, KeybindingServiceImpl, KeybindingRegistryImpl, KeybindingRegistry, KeybindingContext } from '../keybinding';
import { BrowserKeyboardLayoutImpl } from '../keyboard';
import {
  ContextMenuRenderer,
  BrowserContextMenuRenderer,
  IElectronMenuFactory,
} from '../menu';
import { Logger } from '../logger';
import { ComponentRegistry, ComponentRegistryImpl, LayoutContribution } from '../layout';
import { useNativeContextMenu, isElectronRenderer } from '../utils';
import { ElectronContextMenuRenderer, ElectronMenuFactory } from '../menu/electron/electron-menu';
import { createElectronMainApi } from '../utils/electron';
import { IElectronMainUIService } from '@ali/ide-core-common/lib/electron';

export function injectInnerProviders(injector: Injector) {
  // 一些内置抽象实现
  const providers: Provider[] = [
    {
      token: IEventBus,
      useClass: EventBusImpl,
    },
    {
      token: CommandService,
      useClass: CommandServiceImpl,
    },
    {
      token: CommandRegistry,
      useClass: CommandRegistryImpl,
    },
    {
      token: KeybindingService,
      useClass: KeybindingServiceImpl,
    },
    {
      token: KeybindingRegistry,
      useClass: KeybindingRegistryImpl,
    },
    {
      token: KeyboardNativeLayoutService,
      useClass: BrowserKeyboardLayoutImpl,
    },
    {
      token: KeyboardLayoutChangeNotifierService,
      useClass: BrowserKeyboardLayoutImpl,
    },
    {
      token: ContextMenuRenderer,
      useClass: useNativeContextMenu() ? ElectronContextMenuRenderer :  BrowserContextMenuRenderer,
    },
    ClientAppStateService,
    {
      token: ILogger,
      useClass: Logger,
    },
    {
      token: ComponentRegistry,
      useClass: ComponentRegistryImpl,
    },
  ];
  injector.addProviders(...providers);

  if (isElectronRenderer()) {
    injector.addProviders({
      token: IElectronMainMenuService,
      useValue: createElectronMainApi('menu'),
    }, {
      token: IElectronMainUIService,
      useValue: createElectronMainApi('ui'),
    }, {
      token: IElectronMenuFactory,
      useClass: ElectronMenuFactory,
    });
  }

  // 生成 ContributionProvider
  createContributionProvider(injector, ClientAppContribution);
  createContributionProvider(injector, CommandContribution);
  createContributionProvider(injector, KeybindingContribution);
  createContributionProvider(injector, MenuContribution);
  createContributionProvider(injector, KeybindingContext);
  createContributionProvider(injector, LayoutContribution);
}
