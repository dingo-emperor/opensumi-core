import * as React from 'react';
import { useEffect, createRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useInjectable, isElectronRenderer, ViewState } from '@ali/ide-core-browser';
import { Select, Option } from '@ali/ide-components';
import { Select as NativeSelect } from '@ali/ide-core-browser/lib/components/select';
import { OutputService } from './output.service';
import * as styles from './output.module.less';

import Ansi from '../common/ansi';

const style: React.CSSProperties = {
  whiteSpace: 'normal',
  fontFamily: 'monospace',
};

interface IOutputItem {
  line: string;
  id: number;
  onPath: (path: string) => void;
}

const OutputTemplate: React.FC<{ data: IOutputItem; index: number }> = ({ data: { line, onPath }, index }) => {
  return (
    <div style={style} key={`${line}-${index}`}><Ansi linkify={true} onPath={onPath}>{line}</Ansi></div>
  );
};

export const Output = observer(({ viewState }: { viewState: ViewState }) => {
  const outputService = useInjectable<OutputService>(OutputService);
  const outputRef = createRef<HTMLDivElement>();

  useEffect(() => {
    outputService.viewHeight = String(viewState.height);
  }, [viewState.height]);

  useEffect(() => {
    if (outputRef.current) {
      outputService.initOuputMonacoInstance(outputRef.current);
    }
  }, []);

  return <React.Fragment>
    <div className={styles.output} ref={outputRef} />
  </React.Fragment>;
});

export const ChannelSelector = observer(() => {
  const NONE = '<no channels>';

  const outputService = useInjectable<OutputService>(OutputService);
  const channelOptionElements: React.ReactNode[] = [];
  outputService.getChannels().forEach((channel, idx) => {
    channelOptionElements.push(
      isElectronRenderer() ?
      <option value={channel.name} key={`${idx} - ${channel.name}`}>{channel.name}</option> :
      <Option value={channel.name} key={`${idx} - ${channel.name}`}>{channel.name}</Option>,
    );
  });
  if (channelOptionElements.length === 0) {
    channelOptionElements.push(
      isElectronRenderer() ?
      <option key={NONE} value={NONE}>{NONE}</option> :
      <Option key={NONE} value={NONE}>{NONE}</Option>,
    );
  }

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement> | string) {
    let channelName;
    if (typeof event === 'object') {
      channelName = (event.target as HTMLSelectElement).value;
    } else {
      channelName = event;
    }

    if (channelName !== NONE) {
      outputService.updateSelectedChannel(outputService.getChannel(channelName));
    }
  }

  return (
   isElectronRenderer() ?
    <NativeSelect
      value={outputService.selectedChannel ? outputService.selectedChannel.name : NONE}
      onChange={handleChange}
    >{channelOptionElements}</NativeSelect> :
    <Select
      value={outputService.selectedChannel ? outputService.selectedChannel.name : NONE}
      className={styles.select}
      size='small'
      maxHeight={outputService.viewHeight}
      onChange={handleChange}
    >{channelOptionElements}</Select>
  );
});
