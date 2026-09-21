import { Plan, PlanSchema } from '../plan.schema';
import { TokenUsage } from '../token-usage.model';

const GENERATED_AT = '2026-09-15T00:00:00.000Z';
const MODEL_TAG = 'demo-seed';

export const MICROBLOG_DEMO_TOKEN_STATS: TokenUsage = {
  model: 'anthropic/claude-3.5-sonnet',
  promptTokens: 28104,
  completionTokens: 41973,
  totalTokens: 28104 + 41973,
  startedAt: '2026-09-12T23:51:42.000Z',
  generatedAt: GENERATED_AT,
  llmCalls: 6,
};

export const MICROBLOG_DEMO_META = {
  title: 'Microblog Platform (Demo)',
  summary:
    'A reference demo plan for the Microblog platform \u2014 a multi-tenant microblog with real-time fan-out timelines, threaded conversations, media uploads, full-text search, and notifications.',
  generatedAt: GENERATED_AT,
  model: MODEL_TAG,
  featureNumber: 1,
  featureSlug: 'microblog-demo',
  branchName: '001-microblog-demo',
} as const;

const standardAgentInstructions = [
  'Follow the repo root AGENTS.md conventions (signal-first state, Zod-validated IO, no NgModules).',
  'Write tests before implementation; keep coverage at or above the domain-level tddSpec.',
  'Document every public surface in the per-component README inside the target directory.',
];

const frontendAgentInstructions = [
  ...standardAgentInstructions,
  'Mutate signalStore state only via patchState inside withMethods.',
  'All HTTP responses must be Zod-validated before reaching components.',
];

const workerAgentInstructions = [
  ...standardAgentInstructions,
  'Workers must be idempotent; deduplicate by event id before mutating state.',
  'Every long-running job must emit an OpenTelemetry span with the event id as an attribute.',
];

const infraAgentInstructions = [
  ...standardAgentInstructions,
  'Pin base image digests, not tags.',
  'Every alert must link to a runbook in docs/runbooks/.',
];

const c4Context = `C4Context
  title System Context \u2014 Microblog Platform
  Person(reader, "Reader", "Anonymous or authenticated user browsing timelines")
  Person(author, "Author", "Composes posts, threads, replies, and media")
  Person(staff, "Staff", "Moderator and admin in one role")
  System(microblog, "Microblog", "Microblog platform with timelines, threads, and notifications")
  System_Ext(idp, "Identity Provider", "OIDC for staff and OAuth for end users")
  System_Ext(push, "Push Notification Service", "Delivers mobile and web push notifications")
  System_Ext(search, "Search Indexer", "Full-text and trending indexer")
  Rel(reader, microblog, "Browses timelines and replies")
  Rel(author, microblog, "Composes posts and media")
  Rel(staff, microblog, "Reviews reports and users")
  Rel(microblog, idp, "Validates OIDC and OAuth tokens")
  Rel(microblog, push, "Sends push notifications")
  Rel(microblog, search, "Indexes published posts")`;

const c4Container = `C4Container
  title Container Diagram \u2014 Microblog Platform
  Person(reader, "Reader")
  Person(author, "Author")
  Person(staff, "Staff")
  System_Boundary(microblog, "Microblog") {
    Container(web, "Angular SPA", "Angular 17, PrimeNG, NgRx signalStore", "Renders timelines, composer, notifications")
    Container(api, "Microblog API", "Python 3.11, FastAPI, Pydantic v2", "REST and WebSocket API")
    Container(fanout, "Fan-out Worker", "Python, ARQ on Redis Streams", "Materialises home timelines")
    Container(media, "Media Processor", "Python, FFmpeg, Pillow", "Transcodes images and videos")
    Container(notify, "Notification Worker", "Python, ARQ", "Dispatches push notifications")
    ContainerDb(pg, "Primary Store", "PostgreSQL 16", "Users, posts, follows, likes, outbox")
    ContainerDb(redis, "Cache and Streams", "Redis 7", "Timelines, rate limits, Redis Streams")
    ContainerDb(s3, "Object Store", "S3 compatible", "Raw and transcoded media")
  }
  System_Ext(idp, "Identity Provider")
  System_Ext(cdn, "Media CDN")
  System_Ext(push, "Push Notification Service")
  Rel(reader, web, "HTTPS", "JSON and WSS")
  Rel(author, web, "HTTPS", "JSON and WSS")
  Rel(staff, web, "HTTPS", "JSON")
  Rel(web, api, "HTTPS and WSS", "REST and WebSocket")
  Rel(api, pg, "TCP", "SQLAlchemy async")
  Rel(api, redis, "TCP", "redis-py async")
  Rel(api, s3, "HTTPS", "boto3 presigned URLs")
  Rel(api, outbox, "INSERT in tx", "outbox table")
  Rel(fanout, redis, "XADD and XREAD", "fan-out stream")
  Rel(fanout, pg, "INSERT timeline rows", "batch write")
  Rel(media, s3, "HTTPS", "download and upload variants")
  Rel(notify, push, "HTTPS", "push provider")
  Rel(indexer, os, "HTTPS", "bulk index API")
  Rel(api, idp, "HTTPS", "JWKS and userinfo")
  Rel(web, cdn, "HTTPS", "media variants")`;

const boundedContextMap = `flowchart LR
  subgraph Shared
    Identity["Identity and Access"]
  end
  subgraph Backend
    SocialGraph["Social Graph"]
    Posts["Posts and Threads"]
    Engagement["Engagement"]
    Media["Media"]
    Search["Search and Trending"]
    Notifications["Notifications"]
  end
  SocialGraph -->|follow edges| Identity
  Posts -->|author lookup| Identity
  Posts -->|publishes post.published.v1| Engagement
  Posts -->|attaches media refs| Media
  Engagement -->|emits engagement.recorded.v1| Notifications
  Media -->|emits media.processed.v1| Search
  Notifications -->|emits notification.created.v1| WorkersFanout[[Fan-out Worker]]`;

const backendLayerDiagram = `flowchart LR
  I[PostController] --> U[PublishPostUseCase]
  U --> Agg[Post aggregate]
  U --> Repo[PostRepository]
  U --> OB[OutboxRepository]
  U --> Bus[PubSubBus]
  Bus -->|fan-out| FW[Fan-out Worker]
  Bus -->|push| NW[Notification Worker]
  subgraph Domain
    Agg
  end
  subgraph Adapters
    Repo
    OB
    Bus
    FW
    NW
  end`;

const backendComponentTreeDiagram = `classDiagram
  class PostAggregate {
    -id: PostId
    -authorId: UserId
    -body: PostBody
    -replyTo: PostId
    -status: PostStatus
    +publish() void
    +edit() void
    +delete() void
    +reply() Post
  }
  class FollowEdgeAggregate {
    -followerId: UserId
    -followeeId: UserId
    +follow() void
    +unfollow() void
  }
  class EngagementAggregate {
    -userId: UserId
    -postId: PostId
    -kind: EngagementKind
    +record() void
    +undo() void
  }
  class ConversationAggregate {
    -id: ConversationId
    -participants: UserId list
    +send() Message
    +read() void
    +archive() void
  }
  class PublishPostUseCase {
    -repo: PostRepository
    -outbox: OutboxRepository
    -pub: PubSubBus
    +execute(cmd) PostDTO
  }
  class RecordEngagementUseCase {
    -repo: EngagementRepository
    -pub: PubSubBus
    +execute(cmd) void
  }
  class FollowUseCase {
    -repo: SocialGraphRepository
    +execute(cmd) void
  }
  class SearchPostsUseCase {
    -client: SearchClient
    +execute(q) SearchResults
  }
  class PostRepository {
    <<port>>
    +save(post) void
    +get_by_id(id) Post
    +list_by_author(authorId, page) Page
  }
  class OutboxRepository {
    <<port>>
    +append(event) void
    +stream(batch) Iterator
  }
  PublishPostUseCase --> PostAggregate
  PublishPostUseCase --> PostRepository
  PublishPostUseCase --> OutboxRepository
  RecordEngagementUseCase --> EngagementAggregate
  RecordEngagementUseCase --> EngagementRepository
  FollowUseCase --> FollowEdgeAggregate
  FollowUseCase --> SocialGraphRepository
  SearchPostsUseCase --> SearchClient`;

const backendDataFlowDiagram = `sequenceDiagram
  autonumber
  actor Author
  participant Web as Microblog SPA
  participant API as PostController
  participant Auth as AuthMiddleware
  participant UC as PublishPostUseCase
  participant Agg as PostAggregate
  participant Repo as PostRepository
  participant Outbox as OutboxRepository
  participant PubSub as PubSubBus
  participant DB as PostgreSQL
  Author->>Web: click Post
  Web->>API: POST api posts with Bearer JWT
  API->>Auth: require_user
  Auth-->>API: UserPrincipal
  API->>UC: execute PublishPostCommand
  UC->>Agg: publish body replyTo
  Agg-->>UC: Post with post.published.v1
  UC->>Repo: save post
  UC->>Outbox: append post.published.v1
  UC->>PubSub: publish posts topic
  Repo->>DB: BEGIN tx INSERT posts INSERT outbox
  DB-->>Repo: ok
  Repo-->>UC: ok
  UC-->>API: PostDTO
  API-->>Web: 201 Created with PostDTO`;

const backendModuleDepsDiagram = `graph LR
  subgraph Backend["backend layer"]
    Interfaces["interfaces (FastAPI routers and WSS)"]
    Application["application (use cases)"]
    Domain["domain (aggregates and policies)"]
    Infrastructure["infrastructure (adapters)"]
    Shared["shared (events, exceptions)"]
  end
  Interfaces --> Application
  Interfaces --> Domain
  Interfaces --> Shared
  Application --> Domain
  Application --> Infrastructure
  Application --> Shared
  Infrastructure --> Domain
  Infrastructure --> Shared
  classDef boundary fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px
  classDef core fill:#f0fdf4,stroke:#16a34a,stroke-width:1.5px
  classDef adapters fill:#ecfdf5,stroke:#059669,stroke-width:1.5px
  class Interfaces boundary
  class Application,Domain,Shared core
  class Infrastructure adapters`;

const backendStateDiagram = `stateDiagram-v2
  [*] --> draft
  draft --> published: publish
  draft --> deleted: delete
  published --> edited: edit
  edited --> published: republish
  published --> deleted: delete
  published --> hidden: moderate
  hidden --> published: restore
  state Engagement {
    [*] --> none
    none --> liked: like
    liked --> none: unlike
    none --> reposted: repost
    reposted --> none: undo_repost
    none --> bookmarked: bookmark
    bookmarked --> none: unbookmark
  }`;

const backendApiContractDiagram = `sequenceDiagram
  autonumber
  participant Client as Microblog SPA
  participant API as FastAPI PostController
  participant Auth as AuthMiddleware
  participant UC as PublishPostUseCase
  participant Repo as PostRepository
  participant DB as PostgreSQL
  Client->>API: POST api posts body replyTo mediaIds
  Note over Client,API: Headers Authorization Bearer jwt, Idempotency-Key uuid
  API->>Auth: validate JWT
  Auth-->>API: UserPrincipal
  API->>UC: execute PublishPostCommand
  UC->>Repo: save
  Repo->>DB: BEGIN tx INSERT posts INSERT outbox
  alt duplicate Idempotency-Key
    DB-->>Repo: conflict
    Repo-->>API: IdempotencyConflict
    API-->>Client: 409 Conflict code duplicate_request
  else saved
    DB-->>Repo: row
    Repo-->>API: Post
    API-->>Client: 201 Created PostDTO idempotencyReplay safe
  end`;

const backendProjectStructure = `backend/
\u251c\u2500\u2500 pyproject.toml
\u251c\u2500\u2500 alembic.ini
\u251c\u2500\u2500 Dockerfile
\u251c\u2500\u2500 src/
\u2502   \u251c\u2500\u2500 main.py                       # FastAPI composition root
\u2502   \u251c\u2500\u2500 app.py                        # create_app with middleware and routers
\u2502   \u251c\u2500\u2500 config.py                     # pydantic-settings
\u2502   \u251c\u2500\u2500 observability.py              # OpenTelemetry init
\u2502   \u251c\u2500\u2500 shared/
\u2502   \u2502   \u251c\u2500\u2500 events.py                 # typed domain event catalog
\u2502   \u2502   \u251c\u2500\u2500 exceptions.py
\u2502   \u2502   \u2514\u2500\u2500 middleware.py
\u2502   \u251c\u2500\u2500 identity/
\u2502   \u2502   \u2514\u2500\u2500 domain/
\u2502   \u2502       \u251c\u2500\u2500 user_account.py
\u2502   \u2502       \u2514\u2500\u2500 session.py
\u2502   \u251c\u2500\u2500 posts/
\u2502   \u2502   \u251c\u2500\u2500 domain/aggregates/post.py
\u2502   \u2502   \u251c\u2500\u2500 application/use_cases/publish_post.py
\u2502   \u2502   \u251c\u2500\u2500 infrastructure/repositories/postgres_post_repository.py
\u2502   \u2502   \u2514\u2500\u2500 interfaces/routes.py
\u2502   \u251c\u2500\u2500 engagement/
\u2502   \u2502   \u251c\u2500\u2500 domain/aggregates/like.py
\u2502   \u2502   \u251c\u2500\u2500 application/use_cases/record_engagement.py
\u2502   \u2502   \u2514\u2500\u2500 infrastructure/repositories/engagement_repository.py
\u2502   \u251c\u2500\u2500 social_graph/
\u2502   \u2502   \u251c\u2500\u2500 domain/aggregates/follow_edge.py
\u2502   \u2502   \u251c\u2500\u2500 application/use_cases/follow.py
\u2502   \u2502   \u2514\u2500\u2500 infrastructure/repositories/social_graph_repository.py
\u2502   \u251c\u2500\u2500 media/
\u2502   \u2502   \u251c\u2500\u2500 domain/aggregates/media_upload.py
\u2502   \u2502   \u2514\u2500\u2500 infrastructure/object_store.py
\u2502   \u251c\u2500\u2500 search/
\u2502   \u2502   \u251c\u2500\u2500 application/use_cases/search_posts.py
\u2502   \u2502   \u2514\u2500\u2500 infrastructure/opensearch_client.py
\u2502   \u251c\u2500\u2500 notifications/
\u2502   \u2502   \u2514\u2500\u2500 application/use_cases/notify_mentioned.py
\u2502   \u251c\u2500\u2500 direct_messages/
\u2502   \u2502   \u2514\u2500\u2500 application/use_cases/send_direct_message.py
\u2502   \u2514\u2500\u2500 outbox/
\u2502       \u251c\u2500\u2500 outbox_repository.py
\u2502       \u2514\u2500\u2500 dispatcher.py
\u251c\u2500\u2500 migrations/
\u2514\u2500\u2500 tests/
    \u251c\u2500\u2500 unit/
    \u2514\u2500\u2500 integration/`;

const workersLayerDiagram = `flowchart LR
  subgraph Workers["worker processes"]
    FW[Fan-out Worker]
    NW[Notification Worker]
    IX[Search Indexer]
    MW[Media Processor]
    DW[DM Delivery Worker]
  end
  subgraph Streams["Redis Streams"]
    S1[microblog.posts.published]
    S2[microblog.engagement.recorded]
    S3[microblog.media.processed]
    S4[microblog.dm.sent]
  end
  subgraph Stores["stores"]
    PG[(PostgreSQL)]
    RD[(Redis)]
    OS[(OpenSearch)]
    S3Obj[(Object Store)]
  end
  S1 --> FW
  S2 --> NW
  S3 --> IX
  S3 --> MW
  S4 --> DW
  FW -->|INSERT timeline rows batched| PG
  FW -->|LPUSH home cache| RD
  IX -->|bulk index| OS
  MW -->|write variants| S3Obj
  NW -->|POST push payload| Push((Push Provider))
  DW -->|WS fan-out| WS((WebSocket Gateway))`;

const workersComponentTreeDiagram = `classDiagram
  class FanOutDispatcher {
    -reader: StreamReader
    -writer: TimelineWriter
    -cache: TimelineCache
    +run() void
    +dispatch(event) void
  }
  class TimelineMaterializer {
    -repo: TimelineRepository
    +materialize(userId, postId) void
    +dematerialize(userId, postId) void
  }
  class TimelineCache {
    -redis: Redis
    +get(userId) list
    +prepend(userId, postId) void
    +truncate(userId, max) void
  }
  class MentionDetector {
    -extractor: MentionExtractor
    +detect(body) UserId list
  }
  class FanOutScheduler {
    -bus: PubSubBus
    +scheduleMention(notification) void
  }
  class IndexingQueue {
    -client: OpenSearchClient
    -buffer: Buffer
    +enqueue(post) void
    +flush() void
  }
  FanOutDispatcher --> TimelineMaterializer
  FanOutDispatcher --> TimelineCache
  MentionDetector --> FanOutScheduler
  IndexingQueue --> OpenSearchClient`;

const workersDataFlowDiagram = `sequenceDiagram
  autonumber
  participant Bus as PubSubBus
  participant FanOut as FanOutDispatcher
  participant Repo as TimelineRepository
  participant Cache as TimelineCache
  participant PG as PostgreSQL
  participant Redis as Redis
  Bus-->>FanOut: post.published.v1
  FanOut->>Repo: load followers of authorId
  Repo->>PG: SELECT follow edges where followee equals author
  PG-->>Repo: followers
  Repo-->>FanOut: follower list
  loop for each follower
    FanOut->>Repo: insert timeline row
    FanOut->>Cache: prepend postId to home cache
  end
  FanOut-->>Bus: ack post.published.v1
  Note over FanOut,Cache: cache truncated at 800 per user`;

const workersModuleDepsDiagram = `graph LR
  subgraph Workers["workers layer"]
    FanOut["fan_out (dispatcher and materializer)"]
    Notify["notifications (mention detector and scheduler)"]
    Index["search_index (indexer and trending)"]
    Media["media_jobs (transcoder and variants)"]
    Infra["infra (Redis Streams and outbox)"]
  end
  FanOut --> Infra
  Notify --> Infra
  Index --> Infra
  Media --> Infra
  classDef worker fill:#fdf4ff,stroke:#a21caf,stroke-width:1.5px
  class FanOut,Notify,Index,Media,Infra worker`;

const workersStateDiagram = `stateDiagram-v2
  [*] --> idle
  idle --> polling: XREADGROUP
  polling --> processing: event received
  processing --> idle: ack
  processing --> retrying: transient error
  retrying --> processing: backoff
  retrying --> dead: max retries exceeded
  dead --> idle: alert sent and skipped`;

const workersApiContractDiagram = `sequenceDiagram
  autonumber
  participant Bus as PubSubBus
  participant Job as ARQ Job
  participant Repo as TimelineRepository
  participant Cache as TimelineCache
  participant PG as PostgreSQL
  participant Redis as Redis
  Bus-->>Job: post.published.v1
  Job->>Repo: get_followers authorId
  Repo->>PG: SELECT follow edges
  PG-->>Repo: follower ids
  Job->>Repo: bulk_insert timeline
  Repo->>PG: INSERT INTO timeline VALUES
  PG-->>Repo: rows
  Job->>Cache: prepend home userId postId
  Cache->>Redis: LPUSH microblog timeline userId postId
  Job->>Redis: XACK microblog posts published`;

const workersProjectStructure = `workers/
\u251c\u2500\u2500 pyproject.toml
\u251c\u2500\u2500 Dockerfile
\u251c\u2500\u2500 src/
\u2502   \u251c\u2500\u2500 main.py                      # ARQ worker entrypoint
\u2502   \u251c\u2500\u2500 settings.py
\u2502   \u251c\u2500\u2500 fan_out/
\u2502   \u2502   \u251c\u2500\u2500 dispatcher.py
\u2502   \u2502   \u251c\u2500\u2500 materializer.py
\u2502   \u2502   \u2514\u2500\u2500 timeline_cache.py
\u2502   \u251c\u2500\u2500 notifications/
\u2502   \u2502   \u251c\u2500\u2500 mention_detector.py
\u2502   \u2502   \u2514\u2500\u2500 fanout_scheduler.py
\u2502   \u251c\u2500\u2500 search_index/
\u2502   \u2502   \u251c\u2500\u2500 indexer.py
\u2502   \u2502   \u2514\u2500\u2500 trending_calculator.py
\u2502   \u251c\u2500\u2500 media_jobs/
\u2502   \u2502   \u251c\u2500\u2500 transcoder.py
\u2502   \u2502   \u2514\u2500\u2500 variants.py
\u2502   \u2514\u2500\u2500 infra/
\u2502       \u251c\u2500\u2500 streams.py
\u2502       \u2514\u2500\u2500 outbox_consumer.py
\u251c\u2500\u2500 tests/
\u2502   \u251c\u2500\u2500 unit/
\u2502   \u2514\u2500\u2500 integration/`;

const frontendLayerDiagram = `flowchart LR
  subgraph Shell["App Shell"]
    Router[RouterOutlet and lazy loadComponent]
    Layout[AppLayoutComponent]
    TopBar[TopBarComponent]
    Nav[NavRailComponent]
  end
  subgraph Public["Public Routes (lazy)"]
    Home[HomeFeedFeature]
    Profile[ProfileFeature]
    Explore[ExploreFeature]
    Thread[ThreadFeature]
  end
  subgraph Messages["Messages Routes (lazy)"]
    DMs[DmFeature]
  end
  subgraph Core["Core (singletons)"]
    Api[MicroblogApi services]
    Stores[signalStores]
    Schemas[Zod schemas]
  end
  Router --> Home
  Router --> Profile
  Router --> Thread
  Router --> DMs
  Home --> Stores
  Profile --> Stores
  Thread --> Stores
  DMs --> Stores
  Stores --> Api
  Api --> Schemas`;

const frontendComponentTreeDiagram = `classDiagram
  class HomeFeedComponent {
    -store: HomeFeedStore
    +ngOnInit() void
    +loadMore() void
  }
  class PostComposerComponent {
    -store: ComposerStore
    +submit() void
    +attachMedia() void
  }
  class ProfilePageComponent {
    -store: ProfileStore
    -route: ActivatedRoute
    +ngOnInit() void
  }
  class NotificationsPanelComponent {
    -store: NotificationsStore
    +markAllRead() void
  }
  class HomeFeedStore {
    <<signalStore>>
    +posts: Signal list
    +status: Signal status
    +loadHome() void
  }
  class ComposerStore {
    <<signalStore>>
    +body: Signal str
    +mediaIds: Signal list
    +submit() void
  }
  class ProfileStore {
    <<signalStore>>
    +user: Signal User
    +posts: Signal list
    +loadByHandle() void
  }
  class NotificationsStore {
    <<signalStore>>
    +items: Signal list
    +unreadCount: Signal number
    +markAllRead() void
  }
  HomeFeedComponent --> HomeFeedStore
  PostComposerComponent --> ComposerStore
  ProfilePageComponent --> ProfileStore
  NotificationsPanelComponent --> NotificationsStore`;

const frontendDataFlowDiagram = `sequenceDiagram
  autonumber
  participant User as Reader
  participant Web as Microblog SPA
  participant Store as HomeFeedStore
  participant API as Microblog API
  participant Cache as TimelineCache
  User->>Web: open /
  Web->>Store: loadHome()
  Store->>API: GET api timelines home cursor
  API->>Cache: LRANGE microblog timeline userId 0 49
  Cache-->>API: cached post ids
  alt cache hit
    API->>API: hydrate from PostgreSQL
    API-->>Store: 200 with posts
  else cache miss
    API->>API: read from PostgreSQL
    API->>Cache: LPUSH and LTRIM
    API-->>Store: 200 with posts
  end
  Store-->>Web: posts signal updated
  Web-->>User: render feed`;

const frontendModuleDepsDiagram = `graph LR
  subgraph Frontend["frontend layer"]
    Shell["core (shell, router, layout)"]
    Features["features (lazy-loaded)"]
    Stores["core stores (signalStores)"]
    Api["core api (HttpClient wrappers)"]
    Shared["shared (Zod schemas)"]
  end
  Shell --> Features
  Shell --> Stores
  Features --> Stores
  Stores --> Api
  Api --> Shared
  classDef shell fill:#eff6ff,stroke:#1d4ed8,stroke-width:1.5px
  classDef feature fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px
  class Shell shell
  class Features,Stores,Api feature
  class Shared feature`;

const frontendStateDiagram = `stateDiagram-v2
  [*] --> idle
  idle --> loading: loadHome
  loading --> ready: 200 OK
  loading --> error: 4xx or 5xx
  ready --> loading: pull to refresh
  error --> loading: retry
  state Composer {
    [*] --> empty
    empty --> composing: user types
    composing --> submitting: submit
    submitting --> empty: 201 Created
    submitting --> composing: 4xx rollback
  }
  state Notifications {
    [*] --> empty
    empty --> unread: notification received via WSS
    unread --> empty: markAllRead
    unread --> empty: open panel
  }`;

const frontendApiContractDiagram = `sequenceDiagram
  autonumber
  participant Client as Microblog SPA
  participant API as Microblog FastAPI
  participant Auth as AuthMiddleware
  participant Repo as TimelineRepository
  participant DB as PostgreSQL
  Client->>API: GET api timelines home cursor with Bearer JWT
  API->>Auth: validate JWT
  Auth-->>API: UserPrincipal
  API->>Repo: get_home userId cursor
  Repo->>DB: SELECT timeline join posts
  alt empty
    DB-->>Repo: empty
    Repo-->>API: empty page
    API-->>Client: 200 OK posts empty cursor null
  else page
    DB-->>Repo: rows
    Repo-->>API: Page with posts
    API-->>Client: 200 OK posts list nextCursor
  end`;

const frontendProjectStructure = `frontend/
\u251c\u2500\u2500 angular.json
\u251c\u2500\u2500 package.json
\u251c\u2500\u2500 tsconfig.json
\u251c\u2500\u2500 src/
\u2502   \u251c\u2500\u2500 main.ts
\u2502   \u251c\u2500\u2500 index.html
\u2502   \u251c\u2500\u2500 styles.scss
\u2502   \u2514\u2500\u2500 app/
\u2502       \u251c\u2500\u2500 app.ts                   # bootstrapApplication
\u2502       \u251c\u2500\u2500 app.config.ts            # providers router http interceptors
\u2502       \u251c\u2500\u2500 app.routes.ts            # top-level routes (lazy)
\u2502       \u251c\u2500\u2500 core/
\u2502       \u2502   \u251c\u2500\u2500 api/
\u2502       \u2502   \u2502   \u251c\u2500\u2500 microblog.api.ts
\u2502       \u2502   \u2502   \u251c\u2500\u2500 media.api.ts
\u2502       \u2502   \u2502   \u251c\u2500\u2500 dm.api.ts
\u2502       \u2502   \u2502   \u2514\u2500\u2500 notifications.api.ts
\u2502       \u2502   \u251c\u2500\u2500 stores/
\u2502       \u2502   \u2502   \u251c\u2500\u2500 home-feed.store.ts
\u2502       \u2502   \u2502   \u251c\u2500\u2500 composer.store.ts
\u2502       \u2502   \u2502   \u251c\u2500\u2500 profile.store.ts
\u2502       \u2502   \u2502   \u251c\u2500\u2500 notifications.store.ts
\u2502       \u2502   \u2502   \u2514\u2500\u2500 dm.store.ts
\u2502       \u2502   \u251c\u2500\u2500 guards/auth.guard.ts
\u2502       \u2502   \u2514\u2500\u2500 interceptors/auth.interceptor.ts
\u2502       \u251c\u2500\u2500 features/
\u2502       \u2502   \u251c\u2500\u2500 home/                # lazy public reader
\u2502       \u2502   \u251c\u2500\u2500 profile/             # lazy public reader
\u2502       \u2502   \u251c\u2500\u2500 thread/              # lazy public reader
\u2502       \u2502   \u251c\u2500\u2500 explore/             # lazy public reader
\u2502       \u2502   \u251c\u2500\u2500 dm/                  # lazy DMs
\u2502       \u2502   \u251c\u2500\u2500 notifications/       # lazy panel
\u2502       \u2502   \u2514\u2500\u2500 preferences/         # lazy settings
\u2502       \u2514\u2500\u2500 shared/
\u2502           \u251c\u2500\u2500 schemas/             # Zod schemas re-exported from shared/schemas
\u2502           \u2514\u2500\u2500 ui/                  # presentational primitives
\u2514\u2500\u2500 tests/
    \u251c\u2500\u2500 unit/
    \u2514\u2500\u2500 e2e/`;

const sharedLayerDiagram = `flowchart LR
  subgraph Backend["backend"]
    BEAPI[FastAPI]
    BEWorker[ARQ Workers]
  end
  subgraph Frontend["frontend"]
    FEApi[HttpClient and WSS]
    FESchemas[Zod Schema Registry]
  end
  subgraph Shared["shared (source of truth)"]
    Schemas[Zod schemas]
    PySchemas[Pydantic mirrors]
    GenTS[TypeScript types via z.infer]
    Events[AsyncAPI 2 event catalog]
    OpenAPI[OpenAPI 3.1 spec]
  end
  BEAPI --> PySchemas
  BEAPI --> Events
  BEWorker --> Events
  FEApi --> Schemas
  FESchemas --> GenTS
  Schemas -. generates .-> OpenAPI
  Events -. generates .-> OpenAPI`;

const sharedComponentTreeDiagram = `classDiagram
  direction LR
  class ZodRoot {
    <<root schema>>
    +PostSummary
    +UserSummary
    +EngagementCommand
    +DmMessage
    +Page T
  }
  class PydanticMirror {
    <<generated>>
    +PostSummaryDTO
    +UserSummaryDTO
    +EngagementCommandDTO
    +DmMessageDTO
  }
  class EventCatalogue {
    <<AsyncAPI 2>>
    +Post.published.v1
    +Engagement.recorded.v1
    +Media.processed.v1
    +Dm.sent.v1
  }
  class OpenAPISpec {
    <<generated artefact>>
    +paths
    +components.schemas
  }
  class TypeScriptTypes {
    <<generated, z.infer>>
    +PostSummary
    +UserSummary
    +DmMessage
  }
  ZodRoot --> PydanticMirror : codegen
  ZodRoot --> TypeScriptTypes : z.infer
  ZodRoot --> OpenAPISpec : codegen
  EventCatalogue --> OpenAPISpec
  EventCatalogue --> TypeScriptTypes`;

const sharedDataFlowDiagram = `sequenceDiagram
  autonumber
  participant Dev as Developer
  participant Zod as shared schemas posts
  participant Gen as codegen openapi-typescript
  participant OAS as openapi yaml
  participant TS as src types posts
  participant FE as Frontend build
  participant BE as Backend build
  Dev->>Zod: edit PostSummary
  Dev->>Gen: pnpm codegen
  Gen->>Zod: read
  Gen->>OAS: write openapi yaml
  Gen->>TS: write posts
  Dev->>FE: pnpm build
  FE->>TS: import PostSummary
  Dev->>BE: poetry build
  BE->>OAS: openapi-validate
  Note over OAS,BE: Both sides fail-loud if the spec is out of sync with the running code`;

const sharedModuleDepsDiagram = `graph LR
  subgraph Shared["shared layer"]
    ZodRoot[schemas (TypeScript)]
    PyMirror[python (Pydantic)]
    Codegen[codegen scripts]
    OAS[openapi.yaml]
    AAI[asyncapi.yaml]
  end
  ZodRoot --> Codegen
  Codegen --> PyMirror
  Codegen --> OAS
  Codegen --> AAI
  Backend[backend] -. imports .-> PyMirror
  Backend -. validates .-> OAS
  Frontend[frontend] -. imports .-> ZodRoot
  classDef shared fill:#fef3c7,stroke:#d97706,stroke-width:1.5px
  class ZodRoot,PyMirror,Codegen,OAS,AAI shared`;

const sharedStateDiagram = `stateDiagram-v2
  [*] --> drafting
  drafting --> reviewed: PR approved
  reviewed --> generated: codegen ran
  generated --> published: bump version and tag
  published --> deprecated: superseded by vN plus 1`;

const sharedApiContractDiagram = `sequenceDiagram
  autonumber
  participant Gen as Codegen
  participant Zod as shared schemas
  participant OAS as openapi yaml
  participant FE as Frontend CI
  participant BE as Backend CI
  Gen->>Zod: read root schemas
  Gen->>OAS: write
  Gen-->>FE: openapi-typescript types
  Gen-->>BE: pydantic models
  FE->>OAS: openapi-validate
  BE->>OAS: openapi-validate
  alt mismatch
    OAS-->>FE: fail
    OAS-->>BE: fail
  else aligned
    OAS-->>FE: ok
    OAS-->>BE: ok
  end`;

const sharedProjectStructure = `shared/
\u251c\u2500\u2500 schemas/
\u2502   \u251c\u2500\u2500 posts.ts           # Zod root for post payloads
\u2502   \u251c\u2500\u2500 engagement.ts       # like repost bookmark commands
\u2502   \u251c\u2500\u2500 identity.ts         # UserSummary and Session
\u2502   \u251c\u2500\u2500 dm.ts               # DmMessage and Conversation
\u2502   \u251c\u2500\u2500 events.ts           # AsyncAPI aligned event schemas
\u2502   \u2514\u2500\u2500 pagination.ts       # Page T and Cursor
\u251c\u2500\u2500 python/
\u2502   \u251c\u2500\u2500 posts.py           # Pydantic mirror of posts.ts
\u2502   \u251c\u2500\u2500 engagement.py
\u2502   \u251c\u2500\u2500 identity.py
\u2502   \u251c\u2500\u2500 dm.py
\u2502   \u2514\u2500\u2500 events.py
\u251c\u2500\u2500 openapi.yaml            # generated and committed
\u2514\u2500\u2500 asyncapi.yaml           # generated and committed`;

const infraLayerDiagram = `flowchart LR
  Dev[Developer] -->|docker compose up| Local[(Local Stack)]
  CI[GitHub Actions] -->|build and push| Registry[(Container Registry)]
  Registry -->|signed image| Argo[(Argo CD)]
  Argo -->|sync manifests| K8s[(Kubernetes Cluster)]
  K8s -->|spans and metrics| OTel[(OpenTelemetry Collector)]
  OTel --> Prom[(Prometheus)]
  OTel --> Tempo[(Tempo)]
  Prom --> Graf[(Grafana)]
  Tempo --> Graf`;

const infraComponentTreeDiagram = `classDiagram
  class TerraformRoot {
    +module: Modules
  }
  class VpcModule {
    +cidr: str
    +subnets: list
  }
  class EksModule {
    +node_groups: list
    +addons: list
  }
  class RdsModule {
    +engine_version: str
    +instance_class: str
  }
  class ObservabilityStack {
    +otel_collector: HelmRelease
    +prometheus: HelmRelease
    +grafana: HelmRelease
  }
  class CiPipeline {
    +jobs: dict
    +on: Trigger
  }
  class RunbookIndex {
    +runbooks: list
  }
  TerraformRoot "1" *-- "1" VpcModule
  TerraformRoot "1" *-- "1" EksModule
  TerraformRoot "1" *-- "1" RdsModule
  TerraformRoot "1" *-- "1" ObservabilityStack
  CiPipeline --> ObservabilityStack : smoke
  ObservabilityStack --> RunbookIndex : alerts link`;

const infraDataFlowDiagram = `sequenceDiagram
  autonumber
  actor Dev as Developer
  participant CI as GitHub Actions
  participant Registry as Container Registry
  participant Argo as Argo CD
  participant Cluster as Kubernetes Cluster
  participant App as Microblog API and Workers
  participant OTEL as OTel Collector
  actor SRE as On-call SRE
  Dev->>CI: push main
  CI->>CI: build backend image
  CI->>Registry: push image pinned by digest
  CI->>Argo: update image tag in gitops repo
  Argo->>Cluster: apply manifests
  Cluster->>App: rolling deploy
  App->>OTEL: spans and metrics
  alt deploy fails
    Argo-->>Cluster: rollback to previous digest
    Argo-->>SRE: alert
  end
  loop every request
    App->>OTEL: span with method route status duration_ms
  end
  alt SLO breach
    OTEL-->>SRE: PagerDuty alert
    SRE->>App: investigate via runbook
  end`;

const infraModuleDepsDiagram = `graph LR
  subgraph Infra["infra layer"]
    Tf["terraform (modules)"]
    Deploy["deploy (Argo applications)"]
    OTel["observability (collector and dashboards)"]
    CI["ci (GitHub Actions)"]
    Runbooks["docs runbooks"]
  end
  CI --> Tf
  CI --> Deploy
  CI --> OTel
  Deploy --> Tf
  OTel --> Tf
  OTel --> Runbooks
  classDef infra fill:#f1f5f9,stroke:#475569,stroke-width:1.5px
  class Tf,Deploy,OTel,CI,Runbooks infra`;

const infraStateDiagram = `stateDiagram-v2
  [*] --> planning
  planning --> applying: terraform plan approved
  applying --> applied: terraform apply success
  applied --> drifted: drift detected
  drifted --> planning: re-plan
  applied --> destroying: teardown
  destroying --> [*]`;

const infraApiContractDiagram = `sequenceDiagram
  autonumber
  participant CI as GitHub Actions
  participant ECR as Container Registry
  participant Argo as Argo CD
  participant Cluster as Kubernetes
  participant App as Microblog Pods
  participant OTEL as OTel Collector
  CI->>ECR: push image digest sha256
  CI->>Argo: update kustomize image tag
  Argo->>Cluster: apply manifests
  Cluster->>App: rolling restart
  App->>OTEL: startup span
  alt health check fails
    Cluster-->>Argo: rollback to previous digest
    Argo-->>CI: notify failure
  else healthy
    App-->>OTEL: heartbeat metric
  end`;

const infraProjectStructure = `infra/
\u251c\u2500\u2500 terraform/
\u2502   \u251c\u2500\u2500 modules/
\u2502   \u2502   \u251c\u2500\u2500 vpc/
\u2502   \u2502   \u251c\u2500\u2500 eks/
\u2502   \u2502   \u251c\u2500\u2500 rds/
\u2502   \u2502   \u2514\u2500\u2500 elasticache/
\u2502   \u2514\u2500\u2500 envs/
\u2502       \u251c\u2500\u2500 dev/
\u2502       \u251c\u2500\u2500 staging/
\u2502       \u2514\u2500\u2500 prod/
\u251c\u2500\u2500 deploy/
\u2502   \u251c\u2500\u2500 backend/
\u2502   \u251c\u2500\u2500 workers/
\u2502   \u2514\u2500\u2500 frontend/
\u251c\u2500\u2500 observability/
\u2502   \u251c\u2500\u2500 otel-collector-values.yaml
\u2502   \u251c\u2500\u2500 prometheus-rules.yaml
\u2502   \u2514\u2500\u2500 grafana/dashboards/
\u251c\u2500\u2500 ci/
\u2502   \u251c\u2500\u2500 backend-pipeline.yml
\u2502   \u251c\u2500\u2500 frontend-pipeline.yml
\u2502   \u251c\u2500\u2500 workers-pipeline.yml
\u2502   \u2514\u2500\u2500 e2e-pipeline.yml
\u2514\u2500\u2500 docs/runbooks/`;

const identityComponents = [
  {
    id: 'user-account',
    name: 'User Account',
    description: 'Aggregates a user identity with handles, verification, and profile metadata.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Enforce handle uniqueness and reserved-handle rules.',
      'Track verification state (none, pending, verified).',
      'Expose commands to register, verify, and deactivate.',
    ],
    inputs: ['RegisterCommand', 'VerifyCommand', 'DeactivateCommand'],
    outputs: ['UserAccount', 'UserAccount.persisted.v1', 'UserAccount.verified.v1'],
    dependencies: [],
    publicApi: ['register', 'verify', 'deactivate', 'updateProfile'],
    errorHandling: 'Throw typed domain errors (HandleTaken, AlreadyVerified). Map to HTTP 409 / 422.',
    acceptanceCriteria: [
      'Handle is reserved-checked against a snapshot table.',
      'Deactivated users cannot post, like, or DM.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'register rejects a taken handle',
          given: ['an existing user with handle microblog_dev'],
          when: 'register is called with the same handle',
          then: ['HandleTaken is thrown and no user is persisted'],
        },
        {
          description: 'verify transitions pending to verified',
          given: ['a user in pending state'],
          when: 'verify is called with a valid token',
          then: ['the user is verified and UserAccount.verified.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the user repository',
          given: ['a TestBed with an in-memory user repository'],
          when: 'register is invoked with a fresh handle',
          then: ['the user is persisted and an outbox row is inserted'],
        },
      ],
    },
    targetFile: 'backend/src/identity/domain/user_account.py',
    outOfScope: ['OAuth flows (handled by identity_provider_adapter)'],
  },
  {
    id: 'session',
    name: 'Session',
    description: 'Tracks an authenticated session bound to a user and a refresh-token id.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Issue session records on successful OAuth or OIDC callbacks.',
      'Revoke sessions on logout or password reset.',
      'Expose lookup by refresh-token id for token rotation.',
    ],
    inputs: ['IssueCommand', 'RevokeCommand'],
    outputs: ['Session', 'Session.issued.v1', 'Session.revoked.v1'],
    dependencies: [],
    publicApi: ['issue', 'revoke', 'lookup'],
    errorHandling: 'Return null on lookup miss; raise UnknownSession on revoke of an unknown id.',
    acceptanceCriteria: [
      'A revoked session can never be refreshed.',
      'Concurrent issues for the same user produce distinct session ids.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'revoke blocks subsequent lookups',
          given: ['an issued session'],
          when: 'revoke is called and then lookup',
          then: ['lookup returns null'],
        },
        {
          description: 'lookup returns the session by refresh id',
          given: ['an issued session with refresh id r1'],
          when: 'lookup r1 is called',
          then: ['the original session is returned'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the session repository',
          given: ['a TestBed with a Postgres session table'],
          when: 'issue and revoke run sequentially',
          then: ['the session is present then absent in the table'],
        },
      ],
    },
    targetFile: 'backend/src/identity/domain/session.py',
    outOfScope: ['Token signing (handled by the IdP)'],
  },
  {
    id: 'verification-badge',
    name: 'Verification Badge',
    description: 'Owns the verified-badge lifecycle decoupled from the user account.',
    type: 'domain-service' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Decide whether a user is eligible for a verified badge.',
      'Issue and revoke badges without mutating user aggregates directly.',
      'Emit Badge.granted.v1 and Badge.revoked.v1 events.',
    ],
    inputs: ['UserAccountId', 'Eligibility signals'],
    outputs: ['BadgeDecision', 'Badge.granted.v1', 'Badge.revoked.v1'],
    dependencies: [],
    publicApi: ['evaluate', 'grant', 'revoke'],
    errorHandling: 'Raise Ineligible when signals do not meet the policy.',
    acceptanceCriteria: [
      'A revoked badge cannot be granted again without a new eligibility signal.',
      'Grant is idempotent by user id.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'evaluate returns false for a brand-new user',
          given: ['a user with zero followers and a fresh account'],
          when: 'evaluate is called',
          then: ['the result is not eligible'],
        },
        {
          description: 'grant is idempotent',
          given: ['a user with a granted badge'],
          when: 'grant is called again',
          then: ['no second Badge.granted.v1 event is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the badge repository',
          given: ['a TestBed with an in-memory badge store'],
          when: 'grant then revoke run sequentially',
          then: ['the badge is present then absent and two events are emitted'],
        },
      ],
    },
    targetFile: 'backend/src/identity/domain/verification_badge.py',
    outOfScope: ['Visual badge rendering'],
  },
];

const socialGraphComponents = [
  {
    id: 'follow-edge',
    name: 'Follow Edge',
    description: 'Aggregates a directed follow relationship between two users.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Enforce self-follow rejection.',
      'Track follow timestamps for timeline fan-out ordering.',
      'Expose follow and unfollow commands.',
    ],
    inputs: ['FollowCommand', 'UnfollowCommand'],
    outputs: ['FollowEdge', 'graph.followed.v1', 'graph.unfollowed.v1'],
    dependencies: [],
    publicApi: ['follow', 'unfollow', 'isFollowing', 'listFollowers'],
    errorHandling: 'Throw SelfFollow and AlreadyFollowing.',
    acceptanceCriteria: [
      'A follow is rejected when the target has blocked the actor.',
      'Unfollow is idempotent (no event on a no-op).',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'follow rejects a self-follow',
          given: ['a FollowCommand where follower equals followee'],
          when: 'follow is called',
          then: ['SelfFollow is thrown and no edge is persisted'],
        },
        {
          description: 'follow emits graph.followed.v1',
          given: ['two distinct users and no existing edge'],
          when: 'follow is called',
          then: ['an edge is persisted and graph.followed.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the social-graph repository',
          given: ['a TestBed with a Postgres follow_edges table'],
          when: 'follow and then unfollow run',
          then: ['two rows exist then one row remains'],
        },
      ],
    },
    targetFile: 'backend/src/social_graph/domain/follow_edge.py',
    outOfScope: ['Block and mute logic (handled by BlockList and MuteList)'],
  },
  {
    id: 'block-list',
    name: 'Block List',
    description: 'Tracks which users have blocked the current user across all surfaces.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Reject new follows from a blocker to a target they have blocked.',
      'Hide posts from blocked authors on timeline reads.',
      'Expose block and unblock commands.',
    ],
    inputs: ['BlockCommand', 'UnblockCommand'],
    outputs: ['BlockList', 'graph.blocked.v1', 'graph.unblocked.v1'],
    dependencies: [],
    publicApi: ['block', 'unblock', 'isBlockedBy'],
    errorHandling: 'Throw SelfBlock on self-blocks; no-op on a duplicate block.',
    acceptanceCriteria: [
      'Blocked authors do not appear in home timelines.',
      'Unblock re-enables future interactions immediately.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'block is idempotent',
          given: ['an existing block edge'],
          when: 'block is called again',
          then: ['no duplicate event is emitted'],
        },
        {
          description: 'unblock allows a new follow',
          given: ['a previously blocked pair'],
          when: 'unblock then follow run sequentially',
          then: ['the follow succeeds and a graph.followed.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the block repository',
          given: ['a TestBed with a Postgres block_edges table'],
          when: 'block then unblock run',
          then: ['the row is present then absent'],
        },
      ],
    },
    targetFile: 'backend/src/social_graph/domain/block_list.py',
    outOfScope: ['Author-side reporting'],
  },
  {
    id: 'mute-list',
    name: 'Mute List',
    description: 'Maintains a per-user mute list that hides posts without unfollowing.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Hide muted authors from home and list timelines.',
      'Preserve follow state when muting or unmuting.',
      'Expose mute and unmute commands.',
    ],
    inputs: ['MuteCommand', 'UnmuteCommand'],
    outputs: ['MuteList', 'graph.muted.v1', 'graph.unmuted.v1'],
    dependencies: [],
    publicApi: ['mute', 'unmute', 'isMuted'],
    errorHandling: 'Throw SelfMute on self-mutes; no-op on a duplicate mute.',
    acceptanceCriteria: [
      'Muting hides future posts but preserves the existing follow edge.',
      'Unmuting restores posts on the next timeline read.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'mute does not remove the follow edge',
          given: ['an existing follow edge'],
          when: 'mute is called on the same pair',
          then: ['the follow edge remains and graph.muted.v1 is emitted'],
        },
        {
          description: 'unmute is idempotent',
          given: ['a non-muted pair'],
          when: 'unmute is called',
          then: ['no event is emitted and the call is a no-op'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the mute repository',
          given: ['a TestBed with a Postgres mute_edges table'],
          when: 'mute then unmute run',
          then: ['the row is present then absent and the follow edge is unchanged'],
        },
      ],
    },
    targetFile: 'backend/src/social_graph/domain/mute_list.py',
    outOfScope: ['Keyword muting'],
  },
];

const postsComponents = [
  {
    id: 'post',
    name: 'Post',
    description: 'Aggregate that owns a post, its body, and lifecycle status.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Enforce the 280-character body limit.',
      'Reject publishes by blocked authors.',
      'Track edits and deletes with a bounded history.',
    ],
    inputs: ['PublishPostCommand', 'EditPostCommand', 'DeletePostCommand'],
    outputs: ['Post', 'post.published.v1', 'post.edited.v1', 'post.deleted.v1'],
    dependencies: [],
    publicApi: ['publish', 'edit', 'delete', 'reply'],
    errorHandling: 'Throw BodyTooLong and BlockedAuthor.',
    acceptanceCriteria: [
      'Edits within 24h preserve original text in the edit history.',
      'Deleted posts are tombstoned, not hard-deleted.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'publish rejects a 281-character body',
          given: ['a PublishPostCommand with a 281-character body'],
          when: 'publish is called',
          then: ['BodyTooLong is thrown'],
        },
        {
          description: 'publish emits post.published.v1',
          given: ['a valid PublishPostCommand'],
          when: 'publish is called',
          then: ['Post is persisted and post.published.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the post repository',
          given: ['a TestBed with a Postgres posts table'],
          when: 'publish runs and the worker dispatches fan-out',
          then: ['the Post row and outbox row exist and the fan-out job is enqueued'],
        },
      ],
    },
    targetFile: 'backend/src/posts/domain/aggregates/post.py',
    outOfScope: ['Media transcoding (handled by the media worker)'],
  },
  {
    id: 'thread',
    name: 'Thread',
    description: 'Composite aggregate that orders replies into a self-thread.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Order self-replies by createdAt into a thread view.',
      'Cap threads at 25 posts to prevent runaway growth.',
      'Allow append-only edits and deletes inside the thread.',
    ],
    inputs: ['AppendThreadPostCommand', 'CloseThreadCommand'],
    outputs: ['Thread', 'thread.appended.v1', 'thread.closed.v1'],
    dependencies: [],
    publicApi: ['append', 'close', 'list'],
    errorHandling: 'Throw ThreadFull when the cap is exceeded.',
    acceptanceCriteria: [
      'Threads are append-only; existing posts cannot be reordered.',
      'A closed thread rejects new appends with ThreadClosed.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'append rejects the 26th post',
          given: ['a thread with 25 posts'],
          when: 'append is called with one more',
          then: ['ThreadFull is thrown'],
        },
        {
          description: 'list returns posts in createdAt order',
          given: ['three posts appended out of order'],
          when: 'list is called',
          then: ['the result is sorted ascending by createdAt'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the post repository',
          given: ['a TestBed with a Postgres posts table'],
          when: 'three appends run sequentially',
          then: ['list returns three rows in order'],
        },
      ],
    },
    targetFile: 'backend/src/posts/domain/aggregates/thread.py',
    outOfScope: ['Cross-author threads'],
  },
  {
    id: 'media-attachment',
    name: 'Media Attachment',
    description: 'Links a media variant to a post and enforces upload ordering.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Enforce the four-media cap per post.',
      'Track media variants (thumbnail, medium, full) before publish.',
      'Reject posts published before media processing completes.',
    ],
    inputs: ['AttachMediaCommand', 'DetachMediaCommand'],
    outputs: ['MediaAttachment', 'media.attached.v1', 'media.detached.v1'],
    dependencies: [],
    publicApi: ['attach', 'detach', 'list'],
    errorHandling: 'Throw TooManyMedia and MediaNotReady.',
    acceptanceCriteria: [
      'Posts cannot be published with media variants in pending state.',
      'Detach is rejected after the post has been published.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'attach rejects the fifth media',
          given: ['a post with four attachments'],
          when: 'attach is called with a fifth',
          then: ['TooManyMedia is thrown'],
        },
        {
          description: 'attach emits media.attached.v1 only when variants are ready',
          given: ['a media variant with status ready'],
          when: 'attach is called',
          then: ['the attachment is persisted and media.attached.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the media repository',
          given: ['a TestBed with a Postgres media_attachments table'],
          when: 'attach then detach run',
          then: ['the row is present then absent'],
        },
      ],
    },
    targetFile: 'backend/src/posts/domain/aggregates/media_attachment.py',
    outOfScope: ['Media transcoding pipeline (handled by media worker)'],
  },
];

const engagementComponents = [
  {
    id: 'like',
    name: 'Like',
    description: 'Records a user liking a post and exposes undo.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Reject duplicate likes from the same user.',
      'Maintain a per-post like count snapshot.',
      'Emit Engagement.recorded.v1 with kind like.',
    ],
    inputs: ['LikeCommand', 'UnlikeCommand'],
    outputs: ['Like', 'Engagement.recorded.v1', 'Engagement.undone.v1'],
    dependencies: [],
    publicApi: ['like', 'unlike', 'countFor'],
    errorHandling: 'Throw AlreadyLiked; throw NotLiked on undo without prior like.',
    acceptanceCriteria: [
      'Likes from blocked authors are rejected.',
      'Undo decrements the cached count atomically.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'like rejects a duplicate like',
          given: ['an existing Like for user U on post T'],
          when: 'like is called again with the same pair',
          then: ['AlreadyLiked is thrown'],
        },
        {
          description: 'unlike emits Engagement.undone.v1',
          given: ['an existing Like'],
          when: 'unlike is called',
          then: ['the Like is removed and Engagement.undone.v1 is emitted'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the engagement repository',
          given: ['a TestBed with a Postgres likes table'],
          when: 'like then unlike run',
          then: ['the row is present then absent'],
        },
      ],
    },
    targetFile: 'backend/src/engagement/domain/aggregates/like.py',
    outOfScope: ['Timeline fan-out (handled by FanOutDispatcher)'],
  },
  {
    id: 'repost',
    name: 'Repost',
    description: 'Records a user reposting (reposting) a post.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Reject reposts from blocked authors.',
      'Distinguish plain reposts from quote posts.',
      'Emit Engagement.recorded.v1 with kind repost.',
    ],
    inputs: ['RepostCommand', 'UndoRepostCommand'],
    outputs: ['Repost', 'Engagement.recorded.v1', 'Engagement.undone.v1'],
    dependencies: [],
    publicApi: ['repost', 'undo', 'countFor'],
    errorHandling: 'Throw AlreadyReposted; throw NotReposted on undo.',
    acceptanceCriteria: [
      'Reposts do not appear on the author own home timeline.',
      'Quote posts keep the original attribution in the body.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'repost rejects a duplicate repost',
          given: ['an existing Repost for user U on post T'],
          when: 'repost is called again',
          then: ['AlreadyReposted is thrown'],
        },
        {
          description: 'undo restores the pre-repost state',
          given: ['a repost by user U'],
          when: 'undo is called',
          then: ['the Repost is removed and the timeline cache is updated'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the engagement repository',
          given: ['a TestBed with a Postgres reposts table'],
          when: 'repost then undo run',
          then: ['the row is present then absent and one fan-out job is enqueued'],
        },
      ],
    },
    targetFile: 'backend/src/engagement/domain/aggregates/repost.py',
    outOfScope: ['Cross-locale repost annotations'],
  },
  {
    id: 'bookmark',
    name: 'Bookmark',
    description: 'Stores a private per-user bookmark for a post.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Reject duplicate bookmarks from the same user.',
      'Emit Engagement.recorded.v1 with kind bookmark.',
      'List bookmarks in reverse-chronological order.',
    ],
    inputs: ['BookmarkCommand', 'UnbookmarkCommand'],
    outputs: ['Bookmark', 'Engagement.recorded.v1', 'Engagement.undone.v1'],
    dependencies: [],
    publicApi: ['bookmark', 'unbookmark', 'listForUser'],
    errorHandling: 'Throw AlreadyBookmarked and NotBookmarked.',
    acceptanceCriteria: [
      'Bookmarks are visible only to the owning user.',
      'Unbookmark is idempotent (no event on a no-op).',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'bookmark rejects a duplicate bookmark',
          given: ['an existing Bookmark for user U on post T'],
          when: 'bookmark is called again',
          then: ['AlreadyBookmarked is thrown'],
        },
        {
          description: 'listForUser orders by createdAt desc',
          given: ['three bookmarks at distinct timestamps'],
          when: 'listForUser is called',
          then: ['the result is sorted by createdAt desc'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the bookmark repository',
          given: ['a TestBed with a Postgres bookmarks table'],
          when: 'bookmark then unbookmark run',
          then: ['the row is present then absent'],
        },
      ],
    },
    targetFile: 'backend/src/engagement/domain/aggregates/bookmark.py',
    outOfScope: ['Bookmark folders'],
  },
];

const mediaComponents = [
  {
    id: 'media-upload',
    name: 'Media Upload',
    description: 'Tracks the lifecycle of a single media upload from request to ready variants.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Issue presigned URLs for client uploads.',
      'Track upload status (requested, uploaded, processing, ready, failed).',
      'Emit Media.processed.v1 when all variants are ready.',
    ],
    inputs: ['RequestUploadCommand', 'MarkUploadedCommand', 'MarkProcessedCommand'],
    outputs: ['MediaUpload', 'Media.uploaded.v1', 'Media.processed.v1'],
    dependencies: [],
    publicApi: ['requestUpload', 'markUploaded', 'markProcessed'],
    errorHandling: 'Throw UploadTooLarge and UnsupportedMimeType.',
    acceptanceCriteria: [
      'Only the uploading user can mark a media as uploaded.',
      'MarkProcessed is rejected for unknown upload ids.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'requestUpload rejects an oversized file',
          given: ['a RequestUploadCommand with size 50MB and kind image'],
          when: 'requestUpload is called',
          then: ['UploadTooLarge is thrown'],
        },
        {
          description: 'markProcessed emits Media.processed.v1',
          given: ['a media upload in processing status'],
          when: 'markProcessed is called with three variants',
          then: ['Media.processed.v1 is emitted and status becomes ready'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the object store and repository',
          given: ['a TestBed with a Postgres media_uploads table'],
          when: 'requestUpload then markUploaded then markProcessed run',
          then: ['three rows in media_variants exist and the upload is ready'],
        },
      ],
    },
    targetFile: 'backend/src/media/domain/aggregates/media_upload.py',
    outOfScope: ['Transcoding implementation (handled by MediaProcessorJob)'],
  },
  {
    id: 'media-processor',
    name: 'Media Processor',
    description: 'Background service that transcodes uploaded media into variants.',
    type: 'service' as const,
    layer: 'application' as const,
    responsibilities: [
      'Transcode images to thumbnail, medium, and full variants.',
      'Transcode videos to 480p and 720p HLS variants.',
      'Update MediaUpload status to ready on success.',
    ],
    inputs: ['Media.uploaded.v1'],
    outputs: ['Media.processed.v1', 'Media.failed.v1'],
    dependencies: [],
    publicApi: ['processUpload', 'handleFailure'],
    errorHandling: 'Raise and DLQ on permanent failures; retry with backoff on transient errors.',
    acceptanceCriteria: [
      'Failed transcode jobs emit Media.failed.v1 with a reason code.',
      'Transcoding is idempotent by upload id.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'processUpload produces three image variants',
          given: ['a raw image upload id'],
          when: 'processUpload runs',
          then: ['three variants are upserted and Media.processed.v1 is emitted'],
        },
        {
          description: 'handleFailure emits Media.failed.v1',
          given: ['a transcode that raised DecodeError'],
          when: 'handleFailure runs',
          then: ['Media.failed.v1 is emitted with reason decode_error'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the object store',
          given: ['a TestBed with a localstack S3 stub'],
          when: 'processUpload runs end-to-end',
          then: ['three variant objects exist and the upload status is ready'],
        },
      ],
    },
    targetFile: 'workers/src/media_jobs/transcoder.py',
    outOfScope: ['Live-stream ingest'],
  },
  {
    id: 'media-variant',
    name: 'Media Variant',
    description: 'Represents a single transcoded variant (thumbnail, medium, full, HLS).',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Expose a CDN URL once the variant is uploaded.',
      'Track width, height, byte size, and content-type.',
      'Reject variant upserts from non-owning uploads.',
    ],
    inputs: ['UpsertVariantCommand'],
    outputs: ['MediaVariant', 'MediaVariant.ready.v1'],
    dependencies: [],
    publicApi: ['upsert', 'cdnUrlFor'],
    errorHandling: 'Throw VariantMismatch on a width or height that does not match the kind.',
    acceptanceCriteria: [
      'Variants are immutable once published.',
      'cdnUrlFor returns null until the variant is uploaded.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'upsert rejects a mismatched kind',
          given: ['a variant command with kind thumbnail but width 1920'],
          when: 'upsert is called',
          then: ['VariantMismatch is thrown'],
        },
        {
          description: 'cdnUrlFor returns null until uploaded',
          given: ['a freshly upserted variant with status pending'],
          when: 'cdnUrlFor is called',
          then: ['null is returned'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the variant repository',
          given: ['a TestBed with a Postgres media_variants table'],
          when: 'upsert then cdnUrlFor run after upload',
          then: ['a non-null CDN URL is returned'],
        },
      ],
    },
    targetFile: 'backend/src/media/domain/aggregates/media_variant.py',
    outOfScope: ['Signed-URL rotation'],
  },
];

const searchComponents = [
  {
    id: 'search-index',
    name: 'Search Index',
    description: 'Maintains the OpenSearch index of published posts.',
    type: 'repository' as const,
    layer: 'infrastructure' as const,
    responsibilities: [
      'Bulk-index published posts from the indexer worker.',
      'Provide low-latency typeahead lookups.',
      'Hide posts from blocked or muted authors at query time.',
    ],
    inputs: ['Post.published.v1', 'Post.deleted.v1'],
    outputs: ['Indexed posts', 'Search results'],
    dependencies: [],
    publicApi: ['indexPost', 'removePost', 'search'],
    errorHandling: 'Surface OpenSearch errors as SearchUnavailable; never swallow them.',
    acceptanceCriteria: [
      'Search results respect block and mute lists at read time.',
      'A deleted post is removed from the index within 5 seconds.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'indexPost writes a post document',
          given: ['a post.published.v1 event payload'],
          when: 'indexPost is called',
          then: ['a document is upserted into the posts index'],
        },
        {
          description: 'search filters blocked authors',
          given: ['two posts where the author blocks the requesting user'],
          when: 'search is called for that user',
          then: ['no posts from the blocking author are returned'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with OpenSearch',
          given: ['a TestBed with an OpenSearch test container'],
          when: 'indexPost then search run',
          then: ['the indexed post is returned by the search query'],
        },
      ],
    },
    targetFile: 'backend/src/search/infrastructure/opensearch_client.py',
    outOfScope: ['Personalised ranking'],
  },
  {
    id: 'trending-calculator',
    name: 'Trending Calculator',
    description: 'Computes trending hashtags and topics over a rolling 24-hour window.',
    type: 'domain-service' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Aggregate engagement counts per hashtag from the indexer.',
      'Decay counts using a 24-hour half-life.',
      'Expose the top-N trending items for the explore page.',
    ],
    inputs: ['Engagement.recorded.v1'],
    outputs: ['TrendingItem list'],
    dependencies: [],
    publicApi: ['recompute', 'topN'],
    errorHandling: 'Default to last-known-good trending snapshot on computation failure.',
    acceptanceCriteria: [
      'Trending recomputation completes within 30 seconds for 1M events.',
      'Snapshot is served from cache with a 60-second TTL.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'recompute applies half-life decay',
          given: ['two engagements at distinct timestamps'],
          when: 'recompute is called',
          then: ['older engagement contributes a smaller weight'],
        },
        {
          description: 'topN returns at most N items',
          given: ['twelve distinct trending candidates'],
          when: 'topN with limit 10 is called',
          then: ['ten items are returned in descending weight order'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the trending snapshot store',
          given: ['a TestBed with a Postgres trending_snapshots table'],
          when: 'recompute then topN run',
          then: ['a snapshot row is written and topN reads from it'],
        },
      ],
    },
    targetFile: 'workers/src/search_index/trending_calculator.py',
    outOfScope: ['Geo-specific trending'],
  },
  {
    id: 'indexing-queue',
    name: 'Indexing Queue',
    description: 'Buffers index events and flushes them to OpenSearch in batches.',
    type: 'service' as const,
    layer: 'application' as const,
    responsibilities: [
      'Buffer index events up to 500 items or 2 seconds.',
      'Flush on either threshold and ack the input stream.',
      'Backpressure the consumer when OpenSearch is slow.',
    ],
    inputs: ['IndexEvent list'],
    outputs: ['OpenSearch bulk response'],
    dependencies: [],
    publicApi: ['enqueue', 'flush', 'close'],
    errorHandling: 'Retry the batch with exponential backoff; DLQ after 5 attempts.',
    acceptanceCriteria: [
      'The queue never drops events on graceful shutdown.',
      'Flush latency p95 is under 250ms under steady load.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'flush emits a bulk request at 500 items',
          given: ['a queue with 499 items'],
          when: 'enqueue adds a 500th item',
          then: ['a bulk request is fired and the buffer resets'],
        },
        {
          description: 'flush emits a bulk request after 2 seconds',
          given: ['a queue with one item'],
          when: 'the timer elapses',
          then: ['a bulk request is fired for the one item'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with an in-memory OpenSearch stub',
          given: ['a TestBed with a stubbed bulk endpoint'],
          when: 'enqueue 1000 items then flush run',
          then: ['two bulk requests are issued and all items are acked'],
        },
      ],
    },
    targetFile: 'workers/src/search_index/indexer.py',
    outOfScope: ['Per-shard routing'],
  },
];

const notificationsComponents = [
  {
    id: 'notification',
    name: 'Notification',
    description: 'Aggregates a per-user notification entry.',
    type: 'aggregate' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Track notification kind (like, repost, mention, follow, DM).',
      'Maintain read and unread state.',
      'Emit Notification.created.v1 when a notification is persisted.',
    ],
    inputs: ['CreateNotificationCommand', 'MarkReadCommand'],
    outputs: ['Notification', 'Notification.created.v1', 'Notification.read.v1'],
    dependencies: [],
    publicApi: ['create', 'markRead', 'markAllRead', 'listForUser'],
    errorHandling: 'Throw AlreadyRead on a redundant markRead call.',
    acceptanceCriteria: [
      'Notifications older than 30 days are archived, not deleted.',
      'markAllRead is idempotent.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'create rejects a self-notification',
          given: ['a CreateNotificationCommand where actor equals recipient'],
          when: 'create is called',
          then: ['SelfNotification is thrown'],
        },
        {
          description: 'markAllRead is idempotent',
          given: ['ten unread notifications'],
          when: 'markAllRead is called twice',
          then: ['the second call returns zero and emits no events'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the notification repository',
          given: ['a TestBed with a Postgres notifications table'],
          when: 'create then markAllRead run',
          then: ['all rows transition to read'],
        },
      ],
    },
    targetFile: 'backend/src/notifications/domain/aggregates/notification.py',
    outOfScope: ['Push delivery (handled by NotificationWorker)'],
  },
  {
    id: 'mention-detector',
    name: 'Mention Detector',
    description: 'Parses post bodies and DMs to find mentioned handles.',
    type: 'domain-service' as const,
    layer: 'domain' as const,
    responsibilities: [
      'Extract mentions from post bodies and DM bodies.',
      'Resolve handles to user ids at notification time.',
      'Return at most ten distinct user ids per body.',
    ],
    inputs: ['Post body or DM body'],
    outputs: ['Mention list'],
    dependencies: [],
    publicApi: ['detectMentions', 'resolveHandles'],
    errorHandling: 'Skip unknown handles silently rather than throwing.',
    acceptanceCriteria: [
      'Duplicate mentions are deduplicated.',
      'Handles are case-insensitive when resolving.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'detectMentions extracts handles in any case',
          given: ['a body with @Microblog and @microblog'],
          when: 'detectMentions is called',
          then: ['a single mention is returned'],
        },
        {
          description: 'resolveHandles returns null for unknown handles',
          given: ['a handle that does not exist'],
          when: 'resolveHandles is called',
          then: ['null is returned for that handle'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the user repository',
          given: ['a TestBed with seeded users'],
          when: 'detectMentions then resolveHandles run',
          then: ['the list contains only known user ids'],
        },
      ],
    },
    targetFile: 'workers/src/notifications/mention_detector.py',
    outOfScope: ['Mention parsing in non-Latin scripts'],
  },
  {
    id: 'fanout-scheduler',
    name: 'Fan-out Scheduler',
    description: 'Decides when and how to fan out a notification to push and WS channels.',
    type: 'service' as const,
    layer: 'application' as const,
    responsibilities: [
      'Coalesce notifications within a 60-second window per user.',
      'Emit Notification.fanout.v1 to the push and WS workers.',
      'Back off retries on push delivery failure.',
    ],
    inputs: ['Notification.created.v1'],
    outputs: ['Notification.fanout.v1'],
    dependencies: [],
    publicApi: ['schedule', 'cancel', 'flush'],
    errorHandling: 'Retry push delivery up to three times with exponential backoff.',
    acceptanceCriteria: [
      'At most one push per user per coalescing window.',
      'WebSocket fan-out never blocks the API request path.',
    ],
    tddSpec: {
      unitTests: [
        {
          description: 'schedule coalesces within the window',
          given: ['three notifications within 60 seconds'],
          when: 'schedule is called for each',
          then: ['a single Notification.fanout.v1 is emitted'],
        },
        {
          description: 'flush emits immediately when window is exceeded',
          given: ['a notification scheduled at t0'],
          when: 'flush is called at t0 plus 61s',
          then: ['a Notification.fanout.v1 is emitted regardless'],
        },
      ],
      integrationTests: [
        {
          description: 'integration with the push provider stub',
          given: ['a TestBed with a stubbed push provider'],
          when: 'schedule then flush run',
          then: ['a single push payload is sent'],
        },
      ],
    },
    targetFile: 'workers/src/notifications/fanout_scheduler.py',
    outOfScope: ['Email digests'],
  },
];


const rawDemoPlan = {
  meta: MICROBLOG_DEMO_META,
  systemOverview: {
    purpose:
      'Deliver a fast, accessible microblog platform with real-time fan-out timelines, threaded conversations, media uploads, search, and direct messages.',
    context:
      'Replaces a legacy single-server blog with a distributed microblog: a Python FastAPI backend, dedicated fan-out workers, an Angular SPA, and a managed Postgres plus Redis plus OpenSearch stack.',
    keyActors: [
      'Anonymous Reader',
      'Authenticated Reader',
      'Author',
      'Moderator (staff)',
      'Admin (staff)',
    ],
    constraints: [
      'Public timelines must render in under 2 seconds on 4G.',
      'Fan-out latency p95 under 1 second from publish to follower timeline.',
      'Direct messages must be encrypted at rest with envelope encryption.',
    ],
    nfrs: [
      'p95 home feed render under 1.5s on a warm cache.',
      '99.9% availability for the read APIs.',
      'WCAG 2.1 AA compliance for all public pages.',
      'Zero PII in logs; structured logging with correlation IDs.',
    ],
    boundedContextMap,
    c4: {
      contextDiagram: c4Context,
      containerDiagram: c4Container,
    },
  },
  boundedContexts: [
    {
      id: 'identity',
      name: 'Identity and Access',
      description:
        'Manages user accounts, OAuth and OIDC logins, sessions, and the verification badge.',
      layer: 'shared' as const,
      ubiquitousLanguage: {
        UserAccount: 'A registered user with a unique handle, a display name, and a verification state.',
        Session: 'A server-side record of an authenticated client bound to a refresh token id.',
        VerificationBadge:
          'A per-user indicator of trust granted by the verification-badge domain service.',
      },
    },
    {
      id: 'social-graph',
      name: 'Social Graph',
      description: 'Tracks follow, block, and mute relationships between users.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        FollowEdge: 'A directed edge from follower to followee, with a creation timestamp.',
        BlockList: 'A per-user list of blocked accounts; blocks suppress interactions both ways.',
        MuteList: 'A per-user list of muted accounts; mutes hide posts but preserve follows.',
      },
    },
    {
      id: 'posts',
      name: 'Posts and Threads',
      description: 'Owns the post, thread, and media-attachment aggregates and their read APIs.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        Post: 'A short post with up to 280 characters and a lifecycle status.',
        Thread: 'An ordered self-reply chain anchored on a root post.',
        MediaAttachment:
          'A reference from a post to one or more media variants owned by the media context.',
      },
    },
    {
      id: 'engagement',
      name: 'Engagement',
      description: 'Records likes, reposts, and bookmarks per user-post pair.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        Like: 'A user-post pair indicating a positive engagement.',
        Repost: 'A user-post pair indicating a repost; plain or quote.',
        Bookmark: 'A private per-user pointer to a post, ordered by recency.',
      },
    },
    {
      id: 'media',
      name: 'Media',
      description: 'Owns media uploads, variants, and the transcoding worker.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        MediaUpload: 'A single upload tracked from request through ready variants.',
        MediaVariant: 'A single transcoded rendition (thumbnail, medium, full, HLS).',
        MediaProcessor: 'A service that turns a raw upload into ready variants.',
      },
    },
    {
      id: 'search',
      name: 'Search and Trending',
      description: 'Indexes published posts into OpenSearch and computes trending topics.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        SearchIndex: 'The OpenSearch index of published posts with typeahead and full-text search.',
        TrendingItem: 'A ranked hashtag or topic over a rolling 24-hour window with half-life decay.',
        IndexingQueue: 'An in-memory buffer that batches index events to OpenSearch.',
      },
    },
    {
      id: 'notifications',
      name: 'Notifications',
      description: 'Creates and dispatches in-app notifications with coalescing and push fan-out.',
      layer: 'backend' as const,
      ubiquitousLanguage: {
        Notification: 'A per-user record describing a like, repost, mention, follow, or DM event.',
        Mention: 'A handle reference extracted from a post or DM body for notification purposes.',
        FanoutScheduler: 'A coalescing dispatcher that decides when to push a notification.',
      },
    },
  ],

  userStories: [
    {
      id: 'US001',
      title: 'Read a home timeline',
      priority: 'P1',
      description: 'As an authenticated reader, I want to open the home feed and see the latest posts from the people I follow so that I can keep up with the conversation.',
      whyThisPriority: 'Core read path; without this the platform has no value.',
      independentTest: 'A signed-in user with at least 10 followed authors sees a paginated home feed sorted by recency.',
      acceptanceScenarios: [
        {
          id: 'FR-001',
          given: 'a signed-in reader with 10 followed authors who each posted in the last hour',
          when: 'the reader opens the home tab',
          then: 'the feed renders the 10 newest posts in reverse chronological order within 1.5s p95',
        },
        {
          id: 'FR-002',
          given: 'a signed-in reader on the home tab',
          when: 'they scroll past the 25th post',
          then: 'the next page loads via cursor pagination without full reload',
        },
      ],
      boundedContextIds: ['posts', 'social-graph'],
    },
    {
      id: 'US002',
      title: 'Compose and publish a post',
      priority: 'P1',
      description: 'As an authenticated author, I want to compose a post with optional media and publish it so that my followers see it on their home timeline.',
      whyThisPriority: 'Without authoring there is no content to read.',
      independentTest: 'An author composes a 140-char post with one image and sees it on the home timeline of a followed reader within 2s.',
      acceptanceScenarios: [
        {
          id: 'FR-003',
          given: 'a signed-in author on the composer with a valid 140-char body and one image',
          when: 'they tap Publish',
          then: 'the post is persisted with status=published and emitted as post.published.v1',
        },
        {
          id: 'FR-004',
          given: 'a signed-in author on the composer with an empty body',
          when: 'they tap Publish',
          then: 'the publish action is disabled and the body field shows a validation hint',
        },
      ],
      boundedContextIds: ['posts', 'media'],
    },
    {
      id: 'US003',
      title: 'Send a direct message',
      priority: 'P2',
      description: 'As an authenticated user, I want to send an encrypted 1:1 direct message to another user so that we can have a private conversation.',
      whyThisPriority: 'Important for trust, but the public platform works without it.',
      independentTest: 'A user creates a new conversation with another user, sends a message, and the recipient sees the notification fire and the message appear in their inbox within 1s.',
      acceptanceScenarios: [
        {
          id: 'FR-005',
          given: 'two signed-in users A and B with no existing conversation',
          when: 'A opens a new conversation with B and sends a message',
          then: 'the message is persisted ciphertext by the notifications outbox and B sees the decrypted plaintext within 1s',
        },
      ],
      boundedContextIds: ['identity', 'notifications'],
    },
    {
      id: 'US004',
      title: 'Search public posts',
      priority: 'P3',
      description: 'As any visitor, I want to search public posts by keyword so that I can discover content without following the author first.',
      whyThisPriority: 'Discovery; the platform works without it but reach suffers.',
      independentTest: 'A visitor enters a known keyword and the search returns a paginated list of public posts sorted by relevance.',
      acceptanceScenarios: [
        {
          id: 'FR-006',
          given: 'a visitor on the search page with the keyword "election"',
          when: 'they submit the query',
          then: 'the search returns public posts matching "election" ranked by relevance with a relevance score above 0.3',
        },
      ],
      boundedContextIds: ['search', 'posts'],
    },
  ],

  functionalRequirements: [
    {
      id: 'FR-001',
      text: 'The home timeline must render posts in reverse chronological order with cursor pagination.',
      needsClarification: false,
    },
    {
      id: 'FR-002',
      text: 'Post publishing must be idempotent on the Idempotency-Key header.',
      needsClarification: false,
    },
    {
      id: 'FR-003',
      text: 'Direct messages must be encrypted at rest with envelope encryption.',
      needsClarification: false,
    },
    {
      id: 'FR-004',
      text: 'Media uploads must support JPEG, PNG, and MP4 up to 50 MB.',
      needsClarification: true,
      clarificationNote: 'NEEDS CLARIFICATION: confirm exact max size per file and whether GIFs are in scope.',
    },
  ],

  successCriteria: [
    {
      id: 'SC-001',
      text: 'p95 home feed render under 1.5s on a warm cache.',
    },
    {
      id: 'SC-002',
      text: 'Fan-out latency p95 under 1s from publish to follower timeline.',
    },
    {
      id: 'SC-003',
      text: '99.9% availability for the read APIs.',
    },
    {
      id: 'SC-004',
      text: 'Zero PII in logs; structured logging with correlation IDs.',
    },
  ],

  constitution: {
    projectName: 'Microblog Platform (Demo)',
    version: '1.0.0',
    ratifiedAt: GENERATED_AT,
    lastAmendedAt: GENERATED_AT,
    articles: [
      {
        articleNumber: 1,
        title: 'Library-First',
        content: 'Each bounded context ships as a standalone library with a public API and a CLI surface, owned by exactly one team.',
      },
      {
        articleNumber: 2,
        title: 'CLI Interface',
        content: 'Every library exposes a CLI entry point for ad-hoc operations and integration testing; the CLI is the canonical operator interface.',
      },
      {
        articleNumber: 3,
        title: 'Test-First (TDD)',
        content: 'Tests are written before implementation. Every component ships with a tddSpec that lists BDD Given/When/Then scenarios covering the happy path and the primary failure mode.',
      },
      {
        articleNumber: 4,
        title: 'Integration Testing',
        content: 'Real dependencies are exercised in integration tests; only repositories and external adapters are stubbed.',
      },
      {
        articleNumber: 5,
        title: 'Observability',
        content: 'Structured logs with correlation IDs, OpenTelemetry traces, and Prometheus metrics at every cross-process boundary.',
      },
      {
        articleNumber: 6,
        title: 'Versioning & Breaking Changes',
        content: 'Breaking changes require a major version bump and a migration note. Wire payloads use a `.vN` suffix; consumer is responsible for handling at least N-1.',
      },
      {
        articleNumber: 7,
        title: 'Simplicity',
        content: 'Prefer the simplest solution that satisfies the constitution checks. Reject premature abstractions and premature optimisation.',
      },
      {
        articleNumber: 8,
        title: 'Anti-Abstraction',
        content: 'No interface or base class without at least two concrete consumers in the current plan. Repositories do not exist before a second implementation appears.',
      },
      {
        articleNumber: 9,
        title: 'Integration-First Delivery',
        content: 'Every change ships with at least one integration test that exercises the new path end-to-end. Pure unit-test additions are not a release blocker on their own.',
      },
    ],
  },

  architectureLayers: [
    {
      id: 'backend' as const,
      name: 'Backend (Python)',
      description:
        'FastAPI service exposing REST and WebSocket APIs for the public reader and the staff console, backed by PostgreSQL, Redis, S3, and OpenSearch.',
      techStack: [
        'Python 3.11',
        'FastAPI',
        'SQLAlchemy 2 (async)',
        'Alembic',
        'Pydantic v2',
        'redis-py async',
        'ARQ (workers)',
        'boto3',
      ],
      patterns: [
        'Domain-Driven Design (aggregates, bounded contexts)',
        'Clean Architecture (domain, application, infrastructure, interfaces)',
        'Outbox pattern for reliable domain events',
        'Repository pattern with async sessions',
        'Hexagonal ports and adapters',
      ],
      mermaidDiagram: backendLayerDiagram,
      summary:
        'FastAPI service exposing REST and WebSocket APIs for the public reader and the staff console. Follows Clean Architecture (domain, application, infrastructure, interfaces) with DDD aggregates per bounded context. The Post aggregate, repositories, and use cases implement the publish flow; an outbox table feeds the workers.',
      technicalContext: {
        storage: 'PostgreSQL 16 via SQLAlchemy 2 async; outbox table for domain events',
        targetPlatform: 'Linux server (Python 3.11); containerised via Docker',
        performanceGoals: 'p95 GET api timelines home under 200ms; p95 POST post under 400ms',
        constraints:
          'Domain layer MUST have zero framework imports; all status transitions MUST be idempotent and emit exactly one domain event',
        scaleScope: '1M MAU readers, 50k posts per minute at peak, 200 RPS on read endpoints',
      },
      constitutionCheck: [
        'Strict type checking on all Pydantic schemas (extra forbid)',
        'Unit plus integration tests per use case (at least 2 unit, at least 1 integration)',
        'Domain layer has zero framework imports (no FastAPI, SQLAlchemy, or Redis)',
        'Outbox pattern used for every domain event',
        'All authorization checks live in the application layer, not routes',
      ],
      projectStructureTree: backendProjectStructure,
      complexityTracking: [
        {
          violation: 'Outbox table for domain events',
          whyNeeded: 'Guarantees at-least-once delivery to workers without dual-write inconsistencies',
          simplerAlternativeRejected:
            'Direct synchronous call from request handler to worker - would lose events on partial failure and tightly couples the request to the worker runtime',
        },
        {
          violation: 'Repository pattern plus Unit of Work per request',
          whyNeeded: 'Keeps the use-case layer testable without SQLAlchemy sessions and isolates the aggregate from persistence',
          simplerAlternativeRejected:
            'Use cases calling SQLAlchemy sessions directly - couples domain logic to a specific ORM and makes unit tests slow or flaky',
        },
      ],
      componentTreeDiagram: backendComponentTreeDiagram,
      dataFlowDiagram: backendDataFlowDiagram,
      moduleDependenciesDiagram: backendModuleDepsDiagram,
      stateManagementDiagram: backendStateDiagram,
      apiContractDiagram: backendApiContractDiagram,
      directoryStructure: [
        {
          path: 'backend/src/posts',
          description: 'Post, thread, and media-attachment aggregates plus REST APIs.',
          agentInstructions: [
            ...standardAgentInstructions,
            'All post mutations must go through the PublishPostUseCase.',
            'Never import FastAPI or SQLAlchemy from the domain layer.',
          ],
        },
        {
          path: 'backend/src/engagement',
          description: 'Like, repost, and bookmark aggregates plus REST APIs.',
          agentInstructions: [
            ...standardAgentInstructions,
            'Idempotency-Key header is required on every engagement write.',
            'Engagement events fan out via the PubSubBus, never synchronously.',
          ],
        },
        {
          path: 'backend/src/social_graph',
          description: 'Follow, block, and mute aggregates plus REST APIs.',
          agentInstructions: [
            ...standardAgentInstructions,
            'Block edges are checked at the use-case layer before any post write.',
            'Mute edges must not break the existing follow relationship.',
          ],
        },
        {
          path: 'backend/src/shared',
          description: 'Cross-cutting concerns: events, exceptions, middleware, and idempotency.',
          agentInstructions: [
            ...standardAgentInstructions,
            'Event names follow the noun.action.vN convention.',
            'Middleware must be idempotent under retries.',
          ],
        },
      ],
    },

    {
      id: 'backend-workers' as const,
      name: 'Backend Workers',
      description: 'ARQ-based worker processes for fan-out, notifications, indexing, and media transcoding.',
      techStack: ['Python 3.11', 'ARQ', 'redis-py async', 'FFmpeg', 'Pillow', 'OpenSearch client'],
      patterns: [
        'Idempotent consumers keyed by event id',
        'Stream consumer groups with backoff',
        'Batch processing per chunk',
        'Coalescing for fan-out notifications',
      ],
      mermaidDiagram: workersLayerDiagram,
      summary:
        'ARQ-based worker processes for fan-out, notifications, indexing, and media transcoding. Each worker consumes a single Redis stream, deduplicates by event id, and writes back to PostgreSQL, Redis, S3, or OpenSearch. Workers expose a health endpoint and emit OpenTelemetry spans per event.',
      technicalContext: {
        storage: 'Redis Streams for input; PostgreSQL, S3, and OpenSearch for output',
        targetPlatform: 'Linux containers (amd64 plus arm64)',
        performanceGoals:
          'Fan-out dispatcher processes 10k events per minute per replica with p95 latency under 1s',
        constraints:
          'Workers must be idempotent on event id; transient errors retry with backoff up to 5 times',
        scaleScope: '1k concurrent jobs per replica, 6 worker kinds, 3 replicas each',
      },
      constitutionCheck: [
        'Every worker job is idempotent on its event id',
        'Workers never call the API directly; they consume events from Redis Streams',
        'Every job emits an OpenTelemetry span with the event id as an attribute',
        'Failed jobs go to a per-stream DLQ after 5 retries',
        'Worker processes expose a /healthz endpoint',
      ],
      projectStructureTree: workersProjectStructure,
      complexityTracking: [
        {
          violation: 'Redis Streams consumer groups',
          whyNeeded: 'Native backpressure, replay, and per-stream DLQ for at-least-once delivery',
          simplerAlternativeRejected:
            'Polling a Postgres outbox table - doubles DB load and makes replays expensive',
        },
      ],
      componentTreeDiagram: workersComponentTreeDiagram,
      dataFlowDiagram: workersDataFlowDiagram,
      moduleDependenciesDiagram: workersModuleDepsDiagram,
      stateManagementDiagram: workersStateDiagram,
      apiContractDiagram: workersApiContractDiagram,
      directoryStructure: [
        {
          path: 'workers/src/fan_out',
          description: 'Fan-out dispatcher, materializer, and timeline cache.',
          agentInstructions: [
            ...workerAgentInstructions,
            'Batch inserts into the timeline table at 500 rows per chunk.',
            'Cache prepended entries are trimmed to 800 per user.',
          ],
        },
        {
          path: 'workers/src/notifications',
          description: 'Mention detector and fan-out scheduler.',
          agentInstructions: [
            ...workerAgentInstructions,
            'Coalesce notifications within a 60-second window per user.',
            'Push delivery retries with exponential backoff up to three times.',
          ],
        },
        {
          path: 'workers/src/search_index',
          description: 'OpenSearch indexer and trending calculator.',
          agentInstructions: [
            ...workerAgentInstructions,
            'Flush the indexing queue at 500 items or 2 seconds, whichever first.',
            'Trending snapshots are served with a 60-second TTL.',
          ],
        },
        {
          path: 'workers/src/media_jobs',
          description: 'Media transcoder and variant generator.',
          agentInstructions: [
            ...workerAgentInstructions,
            'Transcoding failures DLQ with reason code in the failure event.',
            'Media jobs are idempotent on upload id.',
          ],
        },
      ],
    },

    {
      id: 'frontend' as const,
      name: 'Frontend (Angular)',
      description:
        'Angular 17 standalone-component SPA for timelines, profiles, threads, DMs, and notifications.',
      techStack: [
        'Angular 17 (standalone components)',
        'PrimeNG (Aura preset)',
        'NgRx Signals and signalStore',
        'Zod (runtime schema validation)',
        'Vitest plus Angular Testing Library',
      ],
      patterns: [
        'Standalone components, no NgModules',
        'Signal-first state via NgRx signalStore; mutate only through patchState',
        'Lazy-loaded feature shells',
        'Route guards for authenticated and staff areas',
        'Strict runtime schema validation for HTTP responses',
      ],
      mermaidDiagram: frontendLayerDiagram,
      summary:
        'Angular 17 standalone-component SPA with lazy-loaded feature shells (Home, Profile, Thread, Explore, DMs, Notifications, Preferences). All HTTP responses are validated with Zod before reaching components; state is owned by NgRx signalStores mutated exclusively via patchState. Authenticated routes are guarded by an AuthGuard; staff routes by a StaffGuard.',
      technicalContext: {
        storage: 'Browser memory only; persistence happens via the backend',
        targetPlatform: 'Browser (Chrome 110+, Firefox 110+, Safari 16+)',
        performanceGoals: 'TTI under 3s on a cold cache; largest-contentful-paint under 2s on 4G',
        constraints:
          'No BehaviorSubject or ReplaySubject - use signals only. Mutate signalStore state only via patchState inside withMethods. All HTTP responses must be Zod-validated before reaching components.',
        scaleScope: '1M MAU, 50k posts per minute, 10k signed-in DM sessions per day',
      },
      constitutionCheck: [
        'Strict TypeScript with noImplicitAny and strictNullChecks',
        'Standalone components only - no NgModule declarations',
        'Mutate signalStore state only via patchState inside withMethods',
        'All HTTP responses validated with a Zod schema before reaching components',
        'Lazy-load every top-level feature via loadComponent or loadChildren',
      ],
      projectStructureTree: frontendProjectStructure,
      complexityTracking: [
        {
          violation: 'NgRx signalStore for feature state (vs. plain service plus signals)',
          whyNeeded:
            'Standardises selectors, methods, and patchState boundaries so multiple components can subscribe without cross-feature coupling',
          simplerAlternativeRejected:
            'Plain service exposing writable signals - would let any consumer mutate state and removes the audit boundary between read and write',
        },
        {
          violation: 'Zod schema validation for every HTTP response',
          whyNeeded:
            'Catches upstream contract drift at the seam where the SPA meets the backend instead of crashing a component at render time',
          simplerAlternativeRejected:
            'Trust the typed response - leaves the SPA exposed to silent runtime errors when the backend ships a breaking change',
        },
      ],
      componentTreeDiagram: frontendComponentTreeDiagram,
      dataFlowDiagram: frontendDataFlowDiagram,
      moduleDependenciesDiagram: frontendModuleDepsDiagram,
      stateManagementDiagram: frontendStateDiagram,
      apiContractDiagram: frontendApiContractDiagram,
      directoryStructure: [
        {
          path: 'frontend/src/app/features/home',
          description: 'Public reader feature: home feed and post composer.',
          agentInstructions: [
            ...frontendAgentInstructions,
            'All HTTP responses must be validated with a Zod schema before reaching components.',
            'Lazy-load the route via loadComponent and keep the bundle isolated from /profile.',
          ],
        },
        {
          path: 'frontend/src/app/features/profile',
          description: 'Public reader feature: profile page, header, and tabs.',
          agentInstructions: [
            ...frontendAgentInstructions,
            'Resolve the handle from ActivatedRoute and surface 404 via a dedicated view.',
            'Switching tabs must not re-fetch the user header.',
          ],
        },
        {
          path: 'frontend/src/app/features/dm',
          description: 'DM inbox and conversation view.',
          agentInstructions: [
            ...frontendAgentInstructions,
            'Guard the route with the AuthGuard; never expose DMs to anonymous users.',
            'Encrypt at rest is the backend responsibility; the SPA only stores ciphertext.',
          ],
        },
        {
          path: 'frontend/src/app/features/notifications',
          description: 'Notifications panel and WSS-driven live updates.',
          agentInstructions: [
            ...frontendAgentInstructions,
            'Subscribe to notifications WSS once per session and route through the NotificationsStore.',
            'Mark all read must be reflected in the UI without a full reload.',
          ],
        },
      ],
    },

    {
      id: 'shared' as const,
      name: 'Shared Contracts',
      description: 'Schemas, types, and event catalogs shared between the backend, workers, and the frontend.',
      techStack: ['Zod (TypeScript)', 'Pydantic v2 (Python)', 'OpenAPI 3.1', 'AsyncAPI 2'],
      patterns: [
        'Single source of truth per contract (Zod on the client, Pydantic on the server)',
        'Generated TypeScript types via z.infer',
        'Versioned event names with semantic suffixes (.v1)',
      ],
      mermaidDiagram: sharedLayerDiagram,
      summary:
        'Single source of truth for every API request, response, and domain event that crosses the backend, workers, and frontend boundary. Schemas are written once in Zod (frontend) and mirrored in Pydantic (backend), so TypeScript types are generated via z.infer and the OpenAPI 3.1 spec is generated from the Zod root schemas. Domain events are catalogued in AsyncAPI 2 with a .v1 suffix that bumps on breaking payload changes.',
      technicalContext: {
        storage: 'Source files only (CI-run codegen + repo-committed artefacts)',
        targetPlatform: 'CI-run codegen + repo-committed artefacts',
        performanceGoals: 'Codegen completes in under 30 seconds on CI',
        constraints:
          'No hand-written TypeScript request or response types - every type is z.infer. No breaking changes without a .v2 suffix on the event name.',
        scaleScope: '~80 schemas, ~30 events across 12 bounded contexts',
      },
      constitutionCheck: [
        'Zod schema is the source of truth; TypeScript types and Pydantic models are generated',
        'Every domain event is declared in the AsyncAPI catalogue with a versioned name',
        'OpenAPI 3.1 spec is regenerated on every CI run and committed',
        'Breaking payload changes require a new .vN suffix on the event name',
        'Schemas live in shared/schemas and are imported by both backend and frontend',
      ],
      projectStructureTree: sharedProjectStructure,
      complexityTracking: [
        {
          violation: 'Maintaining schema parity across Zod and Pydantic',
          whyNeeded: 'Lets the backend and frontend evolve independently without silent contract drift',
          simplerAlternativeRejected:
            'Hand-written Pydantic and hand-written TypeScript types - drifts within weeks and causes runtime schema drift errors in the SPA',
        },
      ],
      componentTreeDiagram: sharedComponentTreeDiagram,
      dataFlowDiagram: sharedDataFlowDiagram,
      moduleDependenciesDiagram: sharedModuleDepsDiagram,
      stateManagementDiagram: sharedStateDiagram,
      apiContractDiagram: sharedApiContractDiagram,
      directoryStructure: [
        {
          path: 'shared/schemas',
          description: 'Versioned Zod and Pydantic schemas for API requests, responses, and events.',
          agentInstructions: [
            ...standardAgentInstructions,
            'Schemas are the source of truth; types are inferred, not handwritten.',
            'Bump the version suffix on the event name when changing payload shape.',
          ],
        },
      ],
    },

    {
      id: 'infra' as const,
      name: 'Infrastructure',
      description: 'Containerised runtime, IaC, observability, and CI/CD for the whole stack.',
      techStack: ['Terraform', 'Kubernetes (EKS)', 'PostgreSQL 16', 'Redis 7', 'OpenTelemetry', 'GitHub Actions', 'Argo CD'],
      patterns: [
        '12-factor configuration via environment variables',
        'OpenTelemetry traces and metrics on every request and worker job',
        'Migrations run as a separate one-shot job, not on app start',
        'GitOps via Argo CD with image-digest pinning',
      ],
      mermaidDiagram: infraLayerDiagram,
      summary:
        'Containerised runtime, IaC, observability, and CI/CD for the whole stack. Local development runs the full dependency graph via docker compose; production runs on EKS managed by Argo CD with image digests pinned to the commit SHA. Every request and worker job emits OpenTelemetry traces plus metrics to a central collector, and migrations run as a separate one-shot job, not on app start.',
      technicalContext: {
        storage: 'GitHub Actions cache + container registry (tagged by digest)',
        targetPlatform: 'Linux containers (amd64 plus arm64) on Kubernetes',
        performanceGoals:
          'CI build under 12 minutes; production deploy under 5 minutes; image pull under 30 seconds on a warm cluster',
        constraints:
          'Pin base image digests, not tags. Migrations run as a separate one-shot job, not on app start. Every alert links to a runbook.',
        scaleScope: '3 environments (dev, staging, prod), ~80 services, ~20TB PostgreSQL',
      },
      constitutionCheck: [
        'All images pinned by digest, not tag',
        'Migrations run as a separate one-shot job, not on app start',
        'OpenTelemetry traces and metrics exported on every request and worker job',
        'Every Prometheus alert links to a runbook in docs/runbooks/',
        'CI fails on any uncommitted generated artefact (OpenAPI, TS types)',
      ],
      projectStructureTree: infraProjectStructure,
      complexityTracking: [
        {
          violation: 'OpenTelemetry collector plus Prometheus plus Grafana stack',
          whyNeeded: 'Single pane of glass across FastAPI, Angular SPA, and ARQ workers',
          simplerAlternativeRejected:
            'Vendor-specific APM (NewRelic or Datadog) - high cost and lock-in for a single-team project',
        },
        {
          violation: 'Image digests instead of mutable tags',
          whyNeeded: 'Reproducible rollbacks and zero ambiguity between what is in staging and what is in prod',
          simplerAlternativeRejected:
            'latest or version tags - caused a known incident on a previous project where a base image was re-tagged mid-deploy',
        },
      ],
      componentTreeDiagram: infraComponentTreeDiagram,
      dataFlowDiagram: infraDataFlowDiagram,
      moduleDependenciesDiagram: infraModuleDepsDiagram,
      stateManagementDiagram: infraStateDiagram,
      apiContractDiagram: infraApiContractDiagram,
      directoryStructure: [
        {
          path: 'infra/terraform',
          description: 'Terraform modules and per-env configuration for VPC, EKS, RDS, ElastiCache, and OpenSearch.',
          agentInstructions: [
            ...infraAgentInstructions,
            'Compose files are for local dev only; production deploys use the EKS manifests.',
            'Pin base image digests, not tags.',
          ],
        },
        {
          path: 'infra/observability',
          description: 'OpenTelemetry collector, dashboards, and alert rules.',
          agentInstructions: [
            ...infraAgentInstructions,
            'Every alert must link to a runbook in docs/runbooks/.',
            'Metrics are namespaced by service and bounded context.',
          ],
        },
        {
          path: 'infra/ci',
          description: 'GitHub Actions pipelines for backend, workers, frontend, and e2e tests.',
          agentInstructions: [
            ...infraAgentInstructions,
            'Pipelines fail if any generated artefact is uncommitted.',
            'Image digests are pinned in the deploy manifests, not mutable tags.',
          ],
        },
        {
          path: 'infra/docs/runbooks',
          description: 'Operational runbooks referenced by every alert.',
          agentInstructions: [
            ...infraAgentInstructions,
            'Each runbook includes a summary, an impact statement, and step-by-step mitigations.',
            'Quarterly review verifies that every alert still resolves to a live runbook.',
          ],
        },
      ],
    },
  ],

  domains: [
    {
      id: 'identity',
      name: 'Identity and Access',
      description: 'Shared context for user accounts, sessions, and verification badges.',
      layer: 'shared' as const,
      responsibilities: [
        'Validate OAuth and OIDC bearer tokens against the configured identity provider.',
        'Resolve tokens to UserAccount aggregates with handle and verification state.',
        'Issue and revoke sessions on login, logout, and password reset.',
      ],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/src/identity',
      components: identityComponents,
    },
    {
      id: 'social-graph',
      name: 'Social Graph',
      description: 'Backend context for follow, block, and mute relationships.',
      layer: 'backend' as const,
      responsibilities: [
        'Enforce self-follow rejection on the FollowEdge aggregate.',
        'Track block edges and hide blocked authors from timelines.',
        'Track mute edges without breaking follow relationships.',
      ],
      aggregates: [
        {
          id: 'follow-edge-aggregate',
          name: 'FollowEdge',
          rootEntity: 'FollowEdge',
          description: 'Aggregates a directed follow relationship between two users.',
          invariants: [
            'A user cannot follow themselves.',
            'A user cannot follow another user who has blocked them.',
          ],
          valueObjects: ['FollowerId', 'FolloweeId', 'FollowTimestamp'],
          commands: ['follow', 'unfollow'],
          domainEvents: ['graph.followed.v1', 'graph.unfollowed.v1'],
        },
      ],
      domainEvents: [
        {
          id: 'graph-followed',
          name: 'graph.followed.v1',
          description: 'Raised when a user follows another user.',
          payload: ['followerId', 'followeeId', 'followedAt'],
          triggeredBy: 'FollowEdge.follow()',
          handledBy: ['Fan-out Dispatcher'],
        },
      ],
      directoryPath: 'backend/src/social_graph',
      components: socialGraphComponents,
    },
    {
      id: 'posts',
      name: 'Posts and Threads',
      description: 'Backend context for the post, thread, and media-attachment aggregates.',
      layer: 'backend' as const,
      responsibilities: [
        'Enforce the 280-character body limit and the four-media cap.',
        'Track edits and deletes with a bounded history.',
        'Emit post.published.v1 to the outbox on every publish.',
      ],
      aggregates: [
        {
          id: 'post-aggregate',
          name: 'Post',
          rootEntity: 'Post',
          description: 'Aggregates a single post with a body, a status, and a bounded edit history.',
          invariants: [
            'Body length is at most 280 characters.',
            'A post with status deleted cannot transition to published.',
            'A post published with media references cannot transition until all media are ready.',
          ],
          valueObjects: ['PostId', 'PostBody', 'PostStatus'],
          commands: ['publish', 'edit', 'delete', 'reply'],
          domainEvents: ['post.published.v1', 'post.edited.v1', 'post.deleted.v1'],
        },
      ],
      domainEvents: [
        {
          id: 'post-published',
          name: 'post.published.v1',
          description: 'Raised when a post transitions to published.',
          payload: ['postId', 'authorId', 'body', 'replyTo', 'mediaIds', 'publishedAt'],
          triggeredBy: 'Post.publish()',
          handledBy: ['Fan-out Dispatcher', 'Search Indexer', 'Notification Worker'],
        },
        {
          id: 'post-deleted',
          name: 'post.deleted.v1',
          description: 'Raised when a post is deleted.',
          payload: ['postId', 'deletedAt'],
          triggeredBy: 'Post.delete()',
          handledBy: ['Fan-out Dispatcher', 'Search Indexer'],
        },
      ],
      directoryPath: 'backend/src/posts',
      components: postsComponents,
    },

    {
      id: 'engagement',
      name: 'Engagement',
      description: 'Backend context for likes, reposts, and bookmarks.',
      layer: 'backend' as const,
      responsibilities: [
        'Reject duplicate likes and reposts from the same user.',
        'Maintain per-post engagement count snapshots.',
        'Emit engagement.recorded.v1 for downstream consumers.',
      ],
      aggregates: [],
      domainEvents: [
        {
          id: 'engagement-recorded',
          name: 'engagement.recorded.v1',
          description: 'Raised when a user likes, reposts, or bookmarks a post.',
          payload: ['userId', 'postId', 'kind', 'recordedAt'],
          triggeredBy: 'Like.like() or Repost.repost() or Bookmark.bookmark()',
          handledBy: ['Fan-out Dispatcher', 'Analytics Aggregator'],
        },
      ],
      directoryPath: 'backend/src/engagement',
      components: engagementComponents,
    },
    {
      id: 'media',
      name: 'Media',
      description: 'Backend context for media uploads, variants, and transcoding.',
      layer: 'backend' as const,
      responsibilities: [
        'Issue presigned URLs for client uploads.',
        'Track upload status from requested through ready.',
        'Transcode images and videos into CDN-ready variants.',
      ],
      aggregates: [],
      domainEvents: [
        {
          id: 'media-processed',
          name: 'media.processed.v1',
          description: 'Raised when all variants for an upload are ready.',
          payload: ['uploadId', 'variants', 'processedAt'],
          triggeredBy: 'MediaProcessor.processUpload()',
          handledBy: ['Search Indexer'],
        },
      ],
      directoryPath: 'backend/src/media',
      components: mediaComponents,
    },
    {
      id: 'search',
      name: 'Search and Trending',
      description: 'Backend context for indexing published posts and computing trending topics.',
      layer: 'backend' as const,
      responsibilities: [
        'Bulk-index published posts into OpenSearch with low latency.',
        'Compute trending hashtags and topics on a rolling 24-hour window.',
        'Provide typeahead search at sub-50ms latency.',
      ],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/src/search',
      components: searchComponents,
    },
    {
      id: 'notifications',
      name: 'Notifications',
      description: 'Backend context for in-app notifications with push fan-out.',
      layer: 'backend' as const,
      responsibilities: [
        'Create per-user notifications for likes, reposts, mentions, follows, and DMs.',
        'Coalesce notifications within a 60-second window per user.',
        'Dispatch push notifications via the push provider with retries.',
      ],
      aggregates: [],
      domainEvents: [
        {
          id: 'notification-created',
          name: 'notification.created.v1',
          description: 'Raised when a per-user notification is persisted.',
          payload: ['userId', 'kind', 'actorId', 'subjectId', 'createdAt'],
          triggeredBy: 'Notification.create()',
          handledBy: ['Fan-out Scheduler'],
        },
      ],
      directoryPath: 'backend/src/notifications',
      components: notificationsComponents,
    },
    ],

  workflows: [
    {
      id: 'publish-and-fanout',
      name: 'Publish and Fan-out',
      description: 'Author posts a post; the fan-out worker materialises the post into follower timelines.',
      steps: [
        'Author opens the composer and clicks Post.',
        'POST api posts persists the post and writes an outbox event.',
        'PubSubBus publishes post.published.v1 to the fan-out stream.',
        'Fan-out dispatcher loads followers and writes timeline rows.',
        'Timeline cache prepends the new post id to each follower cache.',
        'SPA home feed receives the new post on the next refresh.',
      ],
      domainIds: ['posts', 'social-graph'],
    },
    {
      id: 'engage-and-notify',
      name: 'Engage and Notify',
      description: 'A like or mention triggers an in-app notification for the author.',
      steps: [
        'Reader likes a post from the home feed.',
        'POST api likes persists the like and writes engagement.recorded.v1.',
        'Notification worker detects the engagement and creates a notification.',
        'Fan-out scheduler coalesces notifications and dispatches push.',
        'The author sees the notification in the panel within 2 seconds.',
      ],
      domainIds: ['engagement', 'notifications'],
    },
    {
      id: 'upload-and-process',
      name: 'Upload and Process',
      description: 'Author attaches media to a post; the media worker produces variants.',
      steps: [
        'Author attaches an image in the composer.',
        'Backend issues a presigned URL and stores the upload in pending status.',
        'Client uploads to the presigned URL and calls markUploaded.',
        'Media worker transcodes the upload into thumbnail, medium, and full variants.',
        'Variants are uploaded to the object store and CDN URLs are returned.',
        'The post publish flow attaches the variants and emits post.published.v1.',
      ],
      domainIds: ['media', 'posts'],
    },
    {
      id: 'search-and-trend',
      name: 'Search and Trend',
      description: 'Search indexer ingests posts and the trending calculator updates the explore page.',
      steps: [
        'Fan-out emits post.published.v1 to the search indexer stream.',
        'Indexing queue buffers posts up to 500 items or 2 seconds.',
        'Indexing queue flushes a bulk request to OpenSearch.',
        'Trending calculator applies half-life decay to engagements.',
        'Explore page serves the top-N trending hashtags from the snapshot.',
      ],
      domainIds: ['search', 'posts'],
    },
    {
      id: 'report-and-enforce',
      name: 'Report and Enforce',
      description: 'Reader reports a post; a staff member triages and applies an enforcement action via the BlockList.',
      steps: [
        'Reader clicks Report on a post and submits a form.',
        'POST api reports persists the report and emits report.created.v1.',
        'Staff reviews the report and applies an enforcement action via the BlockList.',
        'Backend persists the block and emits graph.blocked.v1.',
        'The reported post is hidden from the reporter timelines.',
      ],
      domainIds: ['social-graph', 'posts'],
    },
  ],
  adrs: [
    {
      id: 'ADR-0001',
      title: 'Fan-out on write for home timelines',
      status: 'accepted' as const,
      context:
        'Home timelines must render in under 200ms p95 from a warm cache. Fan-out on read would force a join over follow edges on every read.',
      decision: 'Use fan-out on write via a Redis stream and a dedicated worker that materialises per-user timeline rows and caches.',
      consequences: [
        'Hot authors (verified accounts) require sharded workers to keep up.',
        'Unfollow requires dematerialisation; dematerialisation is implemented by the worker on graph.unfollowed.v1.',
        'Read latency drops from multi-second joins to sub-50ms cache reads.',
      ],
    },
    {
      id: 'ADR-0002',
      title: 'PostgreSQL plus Redis for the primary store',
      status: 'accepted' as const,
      context:
        'We need strong consistency for posts, follows, and engagement with sub-millisecond read latency for hot timelines.',
      decision: 'Use PostgreSQL 16 as the system of record and Redis 7 for the hot-path timeline cache and Redis Streams.',
      consequences: [
        'Postgres handles transactional outbox writes for fan-out reliability.',
        'Redis is treated as a cache; a cold cache falls back to Postgres reads.',
        'Redis failover can lose up to 5 seconds of cache writes; reads recover from Postgres.',
      ],
    },
    {
      id: 'ADR-0003',
      title: 'OpenSearch for full-text and trending',
      status: 'accepted' as const,
      context:
        'Typeahead and full-text search must return results in under 100ms p95 across tens of millions of posts.',
      decision: 'Index published posts into OpenSearch with a dedicated indexer worker and a buffered bulk request strategy.',
      consequences: [
        'A deleted post is removed from the index within 5 seconds.',
        'Trending snapshots are recomputed from the index with a 60-second TTL.',
        'Index failures fall back to a Postgres full-text search query path.',
      ],
    },
    {
      id: 'ADR-0004',
      title: 'S3-compatible object storage plus CDN for media',
      status: 'accepted' as const,
      context:
        'Media uploads include images up to 50MB and videos up to 500MB and must be served with low latency worldwide.',
      decision: 'Store raw and transcoded media in S3-compatible object storage and serve variants through a CDN.',
      consequences: [
        'Presigned URLs keep uploads off the API server.',
        'Variant generation is idempotent on upload id.',
        'CDN cache invalidation is required when a media variant is moderated.',
      ],
    },
    {
      id: 'ADR-0005',
      title: 'NgRx signalStore for frontend state',
      status: 'accepted' as const,
      context:
        'We need fast, signal-based state management with a clear audit boundary between reads and writes.',
      decision: 'Standalone Angular components only, NgRx signalStore for feature state, mutate only via patchState inside withMethods.',
      consequences: [
        'Components cannot mutate state directly; they call store methods.',
        'Schema validation runs at the API service boundary before reaching stores.',
        'Smaller bundles and clearer feature ownership.',
      ],
    },
    {
      id: 'ADR-0006',
      title: 'Zod schemas shared between frontend and backend',
      status: 'accepted' as const,
      context:
        'Type drift between the Angular SPA and the FastAPI backend has caused production schema_drift errors.',
      decision: 'Write every API contract once in Zod (frontend) and mirror it in Pydantic (backend); generate TypeScript types via z.infer and OpenAPI from Zod.',
      consequences: [
        'No hand-written TypeScript request or response types.',
        'Schema changes require a codegen run on CI; CI fails on uncommitted generated artefacts.',
        'Breaking changes require a new .vN suffix on the event name.',
      ],
    },
  ],

  agentTasks: [
    {
      id: 'AT-01',
      title: 'Scaffold backend and workers workspaces',
      description:
        'Create the monorepo layout, backend Python package layout, workers Python package layout, and the docker compose stack.',
      acceptanceCriteria: [
        'backend contains a runnable FastAPI app with a health endpoint.',
        'workers contains a runnable ARQ worker entrypoint that consumes a sample stream.',
        'docker compose up brings up backend, workers, postgres, redis, and opensearch.',
      ],
      fileHints: ['backend/src/main.py', 'workers/src/main.py', 'infra/docker/compose.yml'],
    },
    {
      id: 'AT-02',
      title: 'Implement Post aggregate and repository',
      description: 'Build the Post aggregate, the PostRepository, and SQLAlchemy models for posts and outbox.',
      acceptanceCriteria: [
        'Post aggregate enforces all invariants from the DDD section.',
        'PostRepository round-trips a Post through PostgreSQL.',
        'publish writes both the post row and the outbox row in one transaction.',
        'Tests under backend/tests/posts pass.',
      ],
      fileHints: [
        'backend/src/posts/domain/aggregates/post.py',
        'backend/src/posts/infrastructure/repositories/postgres_post_repository.py',
      ],
    },
    {
      id: 'AT-03',
      title: 'Implement Post REST API',
      description: 'Wire the Post use cases into FastAPI routes and validate requests with Pydantic schemas.',
      acceptanceCriteria: [
        'POST api posts returns 201 with the persisted PostDTO.',
        'GET api posts id returns a single post or 404.',
        'POST api posts requires an Idempotency-Key header.',
        'OpenAPI schema is generated and committed.',
      ],
      fileHints: ['backend/src/posts/interfaces/routes.py', 'shared/python/posts.py'],
    },
    {
      id: 'AT-04',
      title: 'Implement Fan-out Dispatcher worker',
      description: 'Build the worker that consumes post.published.v1 from the Redis stream and materialises timeline rows.',
      acceptanceCriteria: [
        'Dispatcher batches inserts at 500 rows per chunk.',
        'Dispatcher is idempotent on event id.',
        'Dispatcher prepends to the per-user cache and trims to 800 entries.',
        'Tests under workers/tests/fan_out pass.',
      ],
      fileHints: [
        'workers/src/fan_out/dispatcher.py',
        'workers/src/fan_out/materializer.py',
        'workers/src/fan_out/timeline_cache.py',
      ],
    },
    {
      id: 'AT-05',
      title: 'Implement Search Indexer worker',
      description: 'Build the buffered OpenSearch indexer that consumes post.published.v1 and post.deleted.v1.',
      acceptanceCriteria: [
        'Indexer flushes at 500 items or 2 seconds, whichever first.',
        'Indexer removes deleted posts from the index within 5 seconds.',
        'Indexer retries failures with exponential backoff and DLQs after 5 attempts.',
      ],
      fileHints: [
        'workers/src/search_index/indexer.py',
        'backend/src/search/infrastructure/opensearch_client.py',
      ],
    },
    {
      id: 'AT-06',
      title: 'Implement DM Conversation and Message aggregates',
      description: 'Build the 1:1 Conversation and Message aggregates with envelope encryption at rest.',
      acceptanceCriteria: [
        'Conversation reuses an existing pair conversation on a duplicate create.',
        'Message assigns a monotonic sequence per conversation.',
        'delete is rejected after the 60-second window with WindowExpired.',
        'DmEncryption.encrypt then decrypt round-trips a plaintext body.',
      ],
      fileHints: [
        'backend/src/direct_messages/domain/aggregates/conversation.py',
        'backend/src/direct_messages/domain/aggregates/message.py',
        'backend/src/direct_messages/domain/dm_encryption.py',
      ],
    },
    {
      id: 'AT-07',
      title: 'Build the Angular Home Feed feature',
      description: 'Implement the lazy-loaded Home Feed with virtual scrolling and pull-to-refresh.',
      acceptanceCriteria: [
        'HomeFeedComponent renders skeletons while the store is loading.',
        'loadMore is invoked on scroll near the bottom.',
        'TTI under 3 seconds on a warm cache.',
        'Vitest tests for the feature shell and the store pass.',
      ],
      fileHints: [
        'frontend/src/app/features/home/home-feed.component.ts',
        'frontend/src/app/core/stores/home-feed.store.ts',
      ],
    },
    {
      id: 'AT-08',
      title: 'Build the Angular Post Composer feature',
      description: 'Implement the lazy-loaded Composer with character counter and media attachment.',
      acceptanceCriteria: [
        'Submit is disabled when the body is empty or invalid.',
        'Character counter turns red over 260 characters.',
        'Submit is debounced at 600ms.',
        'The store emits submit and resets the composer on 201 Created.',
      ],
      fileHints: [
        'frontend/src/app/features/home/post-composer.component.ts',
        'frontend/src/app/core/stores/composer.store.ts',
      ],
    },
    {
      id: 'AT-09',
      title: 'Wire the Notifications panel to WSS',
      description: 'Implement the Notifications panel with live WebSocket updates and mark-all-read.',
      acceptanceCriteria: [
        'Panel re-renders within 2 seconds of a new notification arriving via WSS.',
        'markAllRead is reflected in the UI without a full reload.',
        'Vitest tests for the store and the WSS subscription pass.',
      ],
      fileHints: [
        'frontend/src/app/features/notifications/notifications-panel.component.ts',
        'frontend/src/app/core/ws/notifications.ws.ts',
        'frontend/src/app/core/stores/notifications.store.ts',
      ],
    },
    {
      id: 'AT-10',
      title: 'Implement the Moderation Report triage service',
      description: 'Build the Report Triage service that assigns reports to the least-loaded moderator.',
      acceptanceCriteria: [
        'assignNext picks the moderator with the lowest open count among those with capacity.',
        'rebalance redistributes a disconnected moderator queue.',
        'Report.assigned.v1 is emitted on assignment.',
        'Tests under backend/tests/moderation pass.',
      ],
      fileHints: [
        'backend/src/moderation/domain/report_triage.py',
        'backend/src/moderation/application/assign_report.py',
      ],
    },
  ],
};

export const MICROBLOG_DEMO_PLAN: Plan = PlanSchema.parse(rawDemoPlan);

export function isDemoPlan(plan: Plan | null | undefined): boolean {
  if (!plan) return false;
  return (
    plan.meta.title === MICROBLOG_DEMO_PLAN.meta.title &&
    plan.meta.generatedAt === MICROBLOG_DEMO_PLAN.meta.generatedAt
  );
}
