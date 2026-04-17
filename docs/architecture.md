# 平台适配器架构

## 设计原则

1. **统一接口**: 所有平台适配器实现相同的接口
2. **可扩展**: 易于添加新平台
3. **错误处理**: 统一的错误处理和重试机制
4. **速率限制**: 内置速率限制保护

## 核心接口

```typescript
interface SocialPlatform {
  name: string;
  
  // 认证
  authenticate(credentials: Credentials): Promise<AuthResult>;
  isAuthenticated(): Promise<boolean>;
  
  // 内容发布
  postContent(content: Content): Promise<PostResult>;
  postImage(image: Image, caption?: string): Promise<PostResult>;
  postVideo(video: Video, caption?: string): Promise<PostResult>;
  postStory(content: Content): Promise<PostResult>;
  
  // 内容管理
  deletePost(postId: string): Promise<boolean>;
  getContent(postId: string): Promise<Content>;
  
  // 互动
  like(postId: string): Promise<boolean>;
  comment(postId: string, text: string): Promise<CommentResult>;
  getComments(postId: string): Promise<Comment[]>;
  
  // 数据
  getAnalytics(postId: string): Promise<Analytics>;
  getProfile(): Promise<Profile>;
  
  // 搜索
  searchHashtags(query: string): Promise<Hashtag[]>;
  searchUsers(query: string): Promise<User[]>;
}
```

## 平台特性对比

| 特性 | Instagram | X | LinkedIn | Reddit | 抖音 | 小红书 |
|------|-----------|---|----------|--------|------|--------|
| 图片发布 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 视频发布 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Story | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 图文混排 | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 话题标签 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 定时发布 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| API 类型 | Graph | REST | REST | REST | REST | 无 |

## 速率限制

| 平台 | 发布限制 | 互动限制 | 备注 |
|------|----------|----------|------|
| Instagram | 25/天 | 200/天 | Business API |
| X | 300/3小时 | 2400/天 | Free tier |
| LinkedIn | 100/天 | 500/天 | Organization |
| Reddit | 60/分钟 | 150/分钟 | OAuth |
| 抖音 | 50/天 | 1000/天 | 企业认证 |
| 小红书 | 未知 | 未知 | 无官方 API |

## 错误处理

```typescript
enum PlatformError {
  RATE_LIMITED = 'RATE_LIMITED',
  AUTH_FAILED = 'AUTH_FAILED',
  CONTENT_REJECTED = 'CONTENT_REJECTED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PLATFORM_ERROR = 'PLATFORM_ERROR',
}

interface ErrorResult {
  platform: string;
  error: PlatformError;
  message: string;
  retryAfter?: number;
  originalError?: any;
}
```
