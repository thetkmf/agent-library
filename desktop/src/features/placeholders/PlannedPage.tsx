import { EmptyState } from '@/components/ui/EmptyState';
import { LinkButton } from '@/components/ui/LinkButton';
import { HOME_ITEM, type NavItem } from '@/app/nav-items';

export interface PlannedPageProps {
  item: NavItem;
}

/**
 * 规划中功能的占位页：说明功能范围与里程碑，避免“点进去是白屏”。
 * 各功能任务（F3–F11）落地后替换为真实页面。
 */
export function PlannedPage({ item }: PlannedPageProps): JSX.Element {
  const Icon = item.icon;
  return (
    <EmptyState
      icon={Icon}
      title={`${item.label}即将上线`}
      description={item.description}
      hint={item.milestone ? `计划里程碑：${item.milestone}；当前阶段为 M0 骨架就绪。` : undefined}
      action={
        <LinkButton size="sm" to="/system">
          查看系统状态
        </LinkButton>
      }
      className="py-16"
    />
  );
}

/** 工作台占位：M1 起替换为最近条目、待办与索引状态总览 */
export function HomePage(): JSX.Element {
  return <PlannedPage item={HOME_ITEM} />;
}

/** 兜底路由：未知路径给出回首页入口 */
export function NotFoundPage(): JSX.Element {
  return (
    <EmptyState
      title="页面不存在"
      description="链接可能已失效，或该功能尚未开放。"
      action={
        <LinkButton size="sm" to="/">
          返回工作台
        </LinkButton>
      }
      hint="如需排查，可在「系统状态」查看本地后端与运行环境。"
      className="py-16"
    />
  );
}
