export function commandMessage(input: {
  type: string;
  label: string;
  status: string;
  revision: number;
  replayed: boolean;
}): string {
  if (input.replayed) return '原请求已经完成。本次只读取结果，没有重复记账。';
  if (input.type === 'stop' && input.status === 'stopping')
    return `停止请求已受理，等待挂单处理或持仓结算；账本版本 ${input.revision}。`;
  return `${input.label}成功；账本版本 ${input.revision}。`;
}
