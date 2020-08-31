import { IMainThreadWebview, WebviewPanelShowOptions, IWebviewPanelOptions, IWebviewOptions, ExtHostAPIIdentifier, IExtHostWebview, IWebviewPanelViewState } from '../../../common/vscode';
import { Injectable, Autowired, Optinal } from '@ali/common-di';
import { IWebviewService, IEditorWebviewComponent, IWebview, IPlainWebview, IPlainWebviewComponentHandle } from '@ali/ide-webview';
import { IRPCProtocol } from '@ali/ide-connection';
import { WorkbenchEditorService, IResource } from '@ali/ide-editor';
import { Disposable, URI, MaybeNull, IEventBus, ILogger, Schemas, IExtensionInfo, CommandRegistry, StorageProvider, STORAGE_SCHEMA, IStorage } from '@ali/ide-core-browser';
import { EditorGroupChangeEvent } from '@ali/ide-editor/lib/browser';
import { IKaitianExtHostWebviews } from '../../../common/kaitian/webview';
import { IIconService, IconType } from '@ali/ide-theme';
import { StaticResourceService } from '@ali/ide-static-resource/lib/browser';
import { viewColumnToResourceOpenOptions } from '../../../common/vscode/converter';
import { IOpenerService } from '@ali/ide-core-browser';
import { HttpOpener } from '@ali/ide-core-browser/lib/opener/http-opener';
import { CommandOpener } from '@ali/ide-core-browser/lib/opener/command-opener';
import throttle = require('lodash.throttle');
import { IActivationEventService } from '../../types';

@Injectable({multiple: true})
export class MainThreadWebview extends Disposable implements IMainThreadWebview {

  @Autowired(IWebviewService)
  webviewService: IWebviewService;

  @Autowired(IActivationEventService)
  activation: IActivationEventService;

  private webivewPanels: Map<string, WebviewPanel> = new Map();

  private plainWebviews: Map<string, IEditorWebviewComponent<IPlainWebview> |  IPlainWebviewComponentHandle > = new Map();

  private webviewPanelStates: Map<string, IWebviewPanelViewState> = new Map();

  private proxy: IExtHostWebview;

  private kaitianProxy: IKaitianExtHostWebviews;

  private _hasSerializer = new Set<string>();

  @Autowired(StorageProvider)
  private getStorage: StorageProvider;

  @Autowired()
  editorService: WorkbenchEditorService;

  @Autowired(IIconService)
  iconService: IIconService;

  @Autowired(IEventBus)
  eventBus: IEventBus;

  @Autowired(ILogger)
  logger: ILogger;

  @Autowired(StaticResourceService)
  staticResourceService: StaticResourceService;

  @Autowired(IOpenerService)
  private readonly openerService: IOpenerService;

  @Autowired(CommandRegistry)
  private readonly commandRegistry: CommandRegistry;

  private statePersister = new Map<string, Promise<(state: any) => Promise<void>>>();

  private extWebviewStorage: Promise<IStorage>;

  constructor(@Optinal(Symbol()) private rpcProtocol: IRPCProtocol) {
    super();
    this.proxy = this.rpcProtocol.getProxy(ExtHostAPIIdentifier.ExtHostWebivew);
    this.kaitianProxy = this.rpcProtocol.getProxy(ExtHostAPIIdentifier.KaitianExtHostWebview);
    this.initEvents();
    this.extWebviewStorage = this.getStorage(new URI('extension-webview-panels').withScheme(STORAGE_SCHEMA.SCOPE));
    this.webviewService.registerWebviewReviver({
      revive: (id) => {
        return this.reviveWebview(id);
      },
      handles: async (id: string) => {
        const persistedWebviewPanelMeta: IWebviewPanelData | undefined = (await this.extWebviewStorage).get<IWebviewPanelData>(id);
        if (persistedWebviewPanelMeta) {
          return 10;
        } else {
          return -1;
        }
      },
    });
  }

  async init() {
    await this.proxy.$init();
  }

  private isSupportedLink(uri: URI, options: IWebviewOptions, extension: IExtensionInfo) {
    if (HttpOpener.standardSupportedLinkSchemes.has(uri.scheme)) {
      return true;
    }
    // webview 支持打开 command 协议
    if (!!options.enableCommandUris && uri.scheme === Schemas.command) {
      // 从 webview 过来的 command 也要做安全校验
      const { id, args } = CommandOpener.parseURI(uri);
      const isPermitted = this.commandRegistry.isPermittedCommand(id, extension, ...args);
      if (!isPermitted) {
        throw new Error(`Extension ${extension.id} has not permit to execute ${id}`);
      }
      return true;
    }
    return false;
  }

  initEvents() {
    this.addDispose(this.editorService.onActiveResourceChange(() => {
      this.onChange();
    }));

    this.addDispose(this.eventBus.on(EditorGroupChangeEvent, () => {
      this.onChange();
    }));
  }

  onChange() {
    const currentResource = this.editorService.currentResource;
    const visibleResources: {
      resource: MaybeNull<IResource>,
      index: number,
    }[] = this.editorService.editorGroups.map((g) => {
      return {
        resource: g.currentResource,
        index: g.index + 1,
      };
    });
    this.webviewPanelStates.forEach((state, id) => {
      if (!this.hasWebviewPanel(id)) {
        return ;
      }
      let hasChange = false;
      const webviewPanel = this.getWebivewPanel(id);
      if (state.active) {
        if (!currentResource || !webviewPanel.resourceUri.isEqual(currentResource.uri)) {
          state.active = false;
          hasChange = true;
        }
      } else {
        if (currentResource && webviewPanel.resourceUri.isEqual(currentResource.uri)) {
          state.active = true;
          hasChange = true;
        }
      }

      if (state.visible) {
        const exist = visibleResources.find((r) => r.resource && r.resource.uri.isEqual(webviewPanel.resourceUri));
        if (!exist) {
          state.visible = false;
          state.position = -1;
          hasChange = true;
        } else {
          if (exist.index !== state.position) {
            state.position = exist.index;
            hasChange = true;
          }
        }
      } else {
        const exist = visibleResources.find((r) => r.resource && r.resource.uri.isEqual(webviewPanel.resourceUri));
        if (exist) {
          state.visible = true;
          state.position = exist.index;
          hasChange = true;
        }
      }

      if (hasChange) {
        this.proxy.$onDidChangeWebviewPanelViewState(id, state);
        if (state.position !== this.getWebivewPanel(id)!.viewColumn) {
          this.getWebivewPanel(id)!.viewColumn = state.position;
          this._persistWebviewPanelMeta(id);
        }
      }

    });
  }

  $createWebviewPanel(id: string, viewType: string , title: string, showOptions: WebviewPanelShowOptions = {}, options: IWebviewPanelOptions & IWebviewOptions = {}, extension: IExtensionInfo): void {
    this.doCreateWebview(id, viewType, title, showOptions, options, extension);
  }

  public async reviveWebview(id: string) {
    const persistedWebivewPanelMeta: IWebviewPanelData | undefined = (await this.extWebviewStorage).get<IWebviewPanelData>(id);
    if (!persistedWebivewPanelMeta) {
      throw new Error('No revival info for webview ' + id);
    }
    const { viewType, webviewOptions, extensionInfo, title} = persistedWebivewPanelMeta;
    await this.activation.fireEvent('onWebviewPanel', viewType);
    const state =  await this.getPersistedWebviewState(viewType, id);
    const editorWebview = this.webviewService.createEditorWebviewComponent({allowScripts: webviewOptions.enableScripts, longLive: webviewOptions.retainContextWhenHidden}, id);
    const viewColumn = editorWebview.group ? editorWebview.group.index + 1 : persistedWebivewPanelMeta.viewColumn;
    await this.doCreateWebview(id, viewType, title, {viewColumn}, webviewOptions, extensionInfo, state);
    await this.proxy.$deserializeWebviewPanel(id, viewType, title, await this.getPersistedWebviewState(viewType, id), viewColumn, webviewOptions);
  }

  private async doCreateWebview(id: string, viewType: string , title: string, showOptions: WebviewPanelShowOptions = {}, options: IWebviewPanelOptions & IWebviewOptions = {}, extension: IExtensionInfo, initialState?: any) {
    const editorWebview = this.webviewService.createEditorWebviewComponent({allowScripts: options.enableScripts, longLive: options.retainContextWhenHidden}, id);
    const webviewPanel = new WebviewPanel(
      id,
      viewType,
      editorWebview.webviewUri,
      editorWebview,
      showOptions,
      options,
      extension,
    );
    this.webivewPanels.set(id, webviewPanel);
    editorWebview.title = title;
    webviewPanel.addDispose(editorWebview);
    webviewPanel.addDispose(editorWebview.webview.onMessage((message) => {
      this.proxy.$onMessage(id, message);
    }));
    webviewPanel.addDispose(editorWebview.webview.onDispose(() => {
      this.proxy.$onDidDisposeWebviewPanel(id);
    }));
    this.webviewPanelStates.set(id, {
      active: false,
      visible: false,
      position: -1,
    });

    this.addDispose({dispose: () => {
      if (this.webivewPanels.has(id)) {
        this.getWebivewPanel(id).dispose();
      }
    }});
    editorWebview.webview.onDidClickLink((e) => {
      if (this.isSupportedLink(e, options, extension)) {
        this.openerService.open(e);
      }
    });
    editorWebview.supportsRevive = this._hasSerializer.has(viewType);
    const editorOpenOptions = viewColumnToResourceOpenOptions(showOptions.viewColumn);
    editorWebview.open(editorOpenOptions);
    if (initialState) {
      editorWebview.webview.state = initialState;
    }
    this.addDispose(editorWebview.webview.onDidUpdateState((state) => {
      if (this._hasSerializer.has(viewType)) {
        this.persistWebviewState(viewType, id, state);
      }
    }));
    this._persistWebviewPanelMeta(id);
  }

  private getWebivewPanel(id): WebviewPanel  {
    if (!this.webivewPanels.has(id)) {
      throw new Error('拥有ID ' + id + ' 的webviewPanel不存在在browser进程中！');
    }
    return this.webivewPanels.get(id)!;
  }

  private hasWebviewPanel(id): boolean {
    return this.webivewPanels.has(id);
  }

  $disposeWebview(id: string): void {
    const webviewPanel = this.getWebivewPanel(id);
    webviewPanel.dispose();
    this.webivewPanels.delete(id);
    this._persistWebviewPanelMeta(id);
  }

  $reveal(id: string, showOptions: WebviewPanelShowOptions = {}): void {
    const webviewPanel = this.getWebivewPanel(id);
    const viewColumn = Object.assign({}, webviewPanel.showOptions, showOptions).viewColumn;
    webviewPanel.editorWebview.open(viewColumnToResourceOpenOptions(viewColumn));
  }

  $setTitle(id: string, value: string): void {
    const webviewPanel = this.getWebivewPanel(id);
    webviewPanel.editorWebview.title = value;
    webviewPanel.title = value;
    this._persistWebviewPanelMeta(id);
  }

  $setIconPath(id: string, value: { light: string; dark: string; hc: string; } | undefined): void {
    const webviewPanel = this.getWebivewPanel(id);
    if (!value) {
      webviewPanel.editorWebview.icon = '';
    } else {
      webviewPanel.editorWebview.icon = this.iconService.fromIcon('', value, IconType.Background)! + ' background-tab-icon';
    }
  }

  $setHtml(id: string, value: string): void {
    const webviewPanel = this.getWebivewPanel(id);
    webviewPanel.editorWebview.webview.setContent(value);
  }

  $setOptions(id: string, options: IWebviewOptions): void {
    const webviewPanel = this.getWebivewPanel(id);
    webviewPanel.editorWebview.webview.updateOptions({allowScripts: options.enableScripts});
  }

  async $postMessage(id: string, value: any): Promise<boolean> {
    try {
      const webviewPanel = this.getWebivewPanel(id);
      await webviewPanel.editorWebview.webview.postMessage(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  $registerSerializer(viewType: string): void {
    this._hasSerializer.add(viewType);
    this.webivewPanels.forEach((panel) => {
      if (panel.viewType === viewType) {
        panel.editorWebview.supportsRevive = true;
      }
    });
  }

  $unregisterSerializer(viewType: string): void {
    this._hasSerializer.add(viewType);
  }

  private _persistWebviewPanelMeta(id: string) {
    return this.extWebviewStorage.then((storage) => {
      if (this.webivewPanels.has(id)) {
        storage.set(id, this.getWebivewPanel(id)!.toJSON());
      } else {
        storage.delete(id);
      }
    });
  }

  async persistWebviewState(viewType: string, id: string, state: any) {
    if (!this.statePersister.has(viewType)) {
      this.statePersister.set(viewType, this.getStorage(new URI('extension-webview/' + viewType).withScheme(STORAGE_SCHEMA.SCOPE))
        .then((storage) => {
          const func = throttle((state: any) => {
            return storage.set(id, state);
          }, 500);
          return async (state: any) => {
            await func(state);
          };
      }));
    }
    (await this.statePersister.get(viewType)!)(state);
  }

  async getPersistedWebviewState(viewType, id): Promise<any>  {
    const storage = await this.getStorage(new URI('extension-webview/' + viewType).withScheme(STORAGE_SCHEMA.SCOPE));
    return storage.get(id);
  }

  $connectPlainWebview(id: string) {
    if (!this.plainWebviews.has(id)) {
      const handle = this.webviewService.getEditorPlainWebviewComponent(id) || this.webviewService.getOrCreatePlainWebviewComponent(id);
      if (handle) {
        this.plainWebviews.set(id, handle);
        handle.webview.onMessage((message) => {
          this.kaitianProxy.$acceptMessage(id, message);
        });
        handle.webview.onDispose(() => {
          this.plainWebviews.delete(id);
        });
      }
    }
  }
  async $postMessageToPlainWebview(id: string, value: any): Promise<boolean> {
    if (this.plainWebviews.has(id)) {
      try {
        await this.plainWebviews.get(id)!.webview.postMessage(value);
        return true;
      } catch (e) {
        this.logger.error(e);
        return false;
      }
    }
    return false;
  }
  async $createPlainWebview(id: string, title: string, iconPath?: string | undefined): Promise<void> {
    const webviewComponent = this.webviewService.createEditorPlainWebviewComponent({}, id);
    webviewComponent.title = title;
    if (iconPath) {
      webviewComponent.icon = this.iconService.fromIcon('', iconPath) || '';
    }
    this.$connectPlainWebview(id);
  }
  async $plainWebviewLoadUrl(id: string, uri: string): Promise<void> {
    if (!this.plainWebviews.has(id)) {
      throw new Error('No Plain Webview With id ' + id);
    }
    await this.plainWebviews.get(id)!.webview.loadURL(uri);
  }

  async $disposePlainWebview(id: string): Promise<void> {
    if (this.plainWebviews.has(id)) {
      this.plainWebviews.get(id)?.dispose();
    }
  }

  async $revealPlainWebview(id: string, groupIndex: number): Promise<void> {
    if (!this.plainWebviews.has(id)) {
      throw new Error('No Plain Webview With id ' + id);
    }
    const handle = this.plainWebviews.get(id);
    if (!(handle as IEditorWebviewComponent<IPlainWebview>).open) {
      throw new Error('not able to open plain webview id:' + id);
    }
    await (handle as IEditorWebviewComponent<IPlainWebview>).open({groupIndex});
  }

  async $getWebviewResourceRoots(): Promise<string[]> {
    return Array.from(this.staticResourceService.resourceRoots);
  }

}

class WebviewPanel extends Disposable {

  public title: string;

  public viewColumn: number;

  constructor(public readonly id: string,
              public readonly viewType: string,
              public readonly resourceUri: URI,
              public readonly editorWebview: IEditorWebviewComponent<IWebview>,
              public readonly showOptions: WebviewPanelShowOptions,
              public readonly options: IWebviewOptions,
              public readonly extensionInfo: IExtensionInfo) {
      super();
  }

  toJSON(): IWebviewPanelData {
    return {
      id: this.id,
      viewType: this.viewType,
      viewColumn: this.viewColumn,
      extensionInfo: this.extensionInfo,
      webviewOptions: this.options,
      title: this.title,
    };
  }
}

interface IWebviewPanelData {
  id: string;
  viewType: string;
  viewColumn: number;
  webviewOptions: IWebviewOptions & IWebviewPanelOptions;
  title: string;
  extensionInfo: IExtensionInfo;
}
