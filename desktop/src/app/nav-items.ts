import {
  Activity,
  Bell,
  BookOpen,
  Clock,
  FolderOpen,
  GraduationCap,
  Home,
  ListChecks,
  MessageSquare,
  Search,
  Settings,
  Share2,
  type LucideIcon,
} from 'lucide-react';

export type FeatureStage = 'ready' | 'planned';

export interface NavItem {
  id: string;
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  stage: FeatureStage;
  /** 规划中功能所属里程碑，用于占位页说明 */
  milestone?: string;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'knowledge',
    label: '知识',
    items: [
      {
        id: 'notes',
        path: '/notes',
        label: '笔记',
        description: 'Markdown / TeX 笔记的创建、编辑与版本管理',
        icon: BookOpen,
        stage: 'ready',
      },
      {
        id: 'files',
        path: '/files',
        label: '文件',
        description: '上传、预览与下载本地文件',
        icon: FolderOpen,
        stage: 'ready',
      },
      {
        id: 'timeline',
        path: '/timeline',
        label: '时间轴',
        description: '按日 / 周 / 月分组的浏览与筛选',
        icon: Clock,
        stage: 'ready',
      },
      {
        id: 'search',
        path: '/search',
        label: '检索',
        description: '关键词、语义与混合检索',
        icon: Search,
        stage: 'ready',
      },
      {
        id: 'graph',
        path: '/graph',
        label: '知识图谱',
        description: '条目、标签与概念之间的关系视图',
        icon: Share2,
        stage: 'planned',
        milestone: 'M3',
      },
    ],
  },
  {
    id: 'assistant',
    label: '助手',
    items: [
      {
        id: 'agent',
        path: '/agent',
        label: 'AI 对话',
        description: '基于本地知识库的流式问答与引用',
        icon: MessageSquare,
        stage: 'ready',
      },
      {
        id: 'tasks',
        path: '/tasks',
        label: '任务中心',
        description: '向量重建、整理、打标等后台任务进度',
        icon: ListChecks,
        stage: 'planned',
        milestone: 'M2',
      },
      {
        id: 'reminders',
        path: '/reminders',
        label: '提醒',
        description: '重复提醒规则与桌面通知',
        icon: Bell,
        stage: 'planned',
        milestone: 'M3',
      },
      {
        id: 'learning',
        path: '/learning',
        label: '学习计划',
        description: '计划看板、里程碑与进度统计',
        icon: GraduationCap,
        stage: 'planned',
        milestone: 'M3',
      },
    ],
  },
  {
    id: 'system',
    label: '系统',
    items: [
      {
        id: 'system-status',
        path: '/system',
        label: '系统状态',
        description: '本地后端、token 与运行环境诊断',
        icon: Activity,
        stage: 'ready',
      },
      {
        id: 'settings',
        path: '/settings',
        label: '设置',
        description: '模型、隐私、存储与画像配置',
        icon: Settings,
        stage: 'planned',
        milestone: 'M3',
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const HOME_ITEM: NavItem = {
  id: 'home',
  path: '/',
  label: '工作台',
  description: '项目总览与最近动态',
  icon: Home,
  stage: 'planned',
  milestone: 'M1',
};

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') {
    return HOME_ITEM;
  }
  const exact = NAV_ITEMS.find((item) => item.path === pathname);
  if (exact) {
    return exact;
  }
  // 子路由（如 /notes/{id}）归属到最近的一级导航
  return NAV_ITEMS.find((item) => pathname.startsWith(`${item.path}/`));
}
