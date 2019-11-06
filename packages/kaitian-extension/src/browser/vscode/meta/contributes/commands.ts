import { VSCodeContributePoint, Contributes, ExtensionService } from '../../../../common';
import { Injectable, Autowired } from '@ali/common-di';
import { CommandRegistry, CommandService, ILogger, PreferenceService, localize, URI, isNonEmptyArray, replaceLocalizePlaceholder } from '@ali/ide-core-browser';
import { ExtHostAPIIdentifier } from '../../../../common/vscode';
import { ThemeType, IIconService } from '@ali/ide-theme';

export interface CommandFormat {

  command: string;

  title: string;

  category: string;

  icon: { [index in ThemeType]: string } | string;

}

export type CommandsSchema = Array<CommandFormat>;

@Injectable()
@Contributes('commands')
export class CommandsContributionPoint extends VSCodeContributePoint<CommandsSchema> {

  @Autowired(CommandRegistry)
  commandRegistry: CommandRegistry;

  @Autowired(CommandService)
  commandService: CommandService;

  @Autowired(ExtensionService)
  extensionService: ExtensionService;

  @Autowired(PreferenceService)
  preferenceService: PreferenceService;

  @Autowired(IIconService)
  iconService: IIconService;

  @Autowired(ILogger)
  logger: ILogger;

  private getLocalieFromNlsJSON(title: string) {
    const nlsRegx = /^%([\w\d.-]+)%$/i;
    const result = nlsRegx.exec(title);
    if (result) {
      return localize(result[1], undefined, this.extension.id);
    }
    return title;
  }

  async contribute() {
    this.json.forEach((command) => {
      this.addDispose(this.commandRegistry.registerCommand({
        category: this.getLocalieFromNlsJSON(command.category),
        label: this.getLocalieFromNlsJSON(command.title),
        id: command.command,
        iconClass: this.iconService.fromIcon(this.extension.path, command.icon),
      }, {
        execute: async (...args) => {
          this.logger.log(command.command);
          // 获取扩展的 command 实例
          const proxy = await this.extensionService.getProxy(ExtHostAPIIdentifier.ExtHostCommands);
          // 实际执行的为在扩展进展中注册的处理函数
          args = args.map((arg) => processArgument(arg));
          return await proxy.$executeContributedCommand(command.command, ...args);
        },
      }));
    });
  }

}

// so hacky
// we do this in the main.thread.commands.ts
function processArgument(arg: any) {
  if (arg instanceof URI) {
    return (arg as URI).codeUri;
  }

  // 数组参数的处理
  if (isNonEmptyArray(arg)) {
    return arg.map((item) => {
      if (item instanceof URI) {
        return (item as URI).codeUri;
      }
      return item;
    });
  }

  return arg;
}
