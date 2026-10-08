# 思维工坊数据模型与索引 V1.0

日期：2026年10月3日  
依据：[产品 V1.1](../product/product-spec-v1.1.md)及[技术架构](technical-design-v1.0.md)。数据库采用 CloudBase 文档型数据库。MW08 已在 mw-test 落地 `identities` / `members` / `member_stats`，并复用 `app_config.policies`、`idempotency`、`audit_logs`；其余集合仍待对应任务创建。本节是约束，不表示全部集合已创建。

## 1 通用约定

实体字段使用 camelCase，集合使用 snake_case。所有记录包含 _id、schemaVersion、createdAt、updatedAt；可变记录含 revision，修改时比较预期版本。时间使用 UTC，分值与人民币分使用安全整数，禁止浮点累积。

记号 H(x) 表示对带字段名和固定顺序的规范 JSON 做 SHA-256 并使用完整十六进制结果。按实际 SDK 对 ID 的长度及字符要求验证后冻结编码；若长度不符，使用等价完整摘要编码，不截短碰撞安全性。

内部唯一性优先使用确定性 _id，并在事务中“读不存在后创建”；随机实体标识不承载业务含义。枚举由 shared 导出，任何未定义字段默认拒绝写入，不能把客户端对象整体合并进数据库。

所有下列集合对客户端直接访问设为拒绝。后台管理员同样通过服务端业务接口，不凭 Web SDK 直写生产数据。

## 2 身份与配置

| 集合 | 主键及核心字段 | 关键规则 |
| --- | --- | --- |
| identities | `_id = H(provider,appId,openId)`，memberId | 私有身份映射；不存 OPENID 明文。注册事务内按确定性 `_id` 唯一建立，禁止先查后写。 |
| members | `_id = H(kind,identityId)`，nickname、avatarKey、status、rankingOptIn、consentVersions、revision | status 为 active、disabled、deleting、deleted；rankingOptIn 默认 false；不混存角色、积分或 VIP。协议同意写在 `consentVersions`，不另建协议集合。 |
| member_stats | `_id = memberId`，totalScore、scoreSeq、levelId、growthVersion、revision | 注册时初始化为 0 / L1；总分不是客户端字段。MW08 不创建勋章或 VIP 账本。 |
| active_attempts | memberId，attemptId 或 null | 每会员一个进行中记录的并发约束 |
| admin_users | CloudBase uid，roles、enabled、authVersion | 角色枚举 content、operations、super；预置白名单 |
| app_config | 固定键 maintenance、catalog、growth、policies 等 | 每键一文档，内容必须有版本；支付密钥不放此集合 |
| audit_logs | 随机 ID，actorType、actorId、action、target、reason、requestId、beforeHash、afterHash | 只追加，受控查询，不记录完整题目及支付秘密 |

maintenance 中分别保存 contentWrites、attemptStart、attemptSubmit、purchaseCreate、entitlementApply 等开关及原因、jobId，不能用一个总开关误阻断支付回调，也不能误阻断 MW08 的注册与资料更新。catalog 保存当前结构版本及 categoryMetricsGeneration。growth 文档内保存当前生效的少量等级及门槛，授予记录另存。policies 保存当前有效的 `agreementVersion` / `privacyVersion`；MW08 使用测试稿版本，正式文案由 MW24 接入。

`identities` / `members` / `member_stats` 均按确定性 `_id` 点读，数据模型第 7 节未为它们规定组合索引；MW08 不另建索引。

## 3 类目与内容

| 集合 | 主键及核心字段 | 关键规则 |
| --- | --- | --- |
| categories | categoryId，parentId、depth、ancestorIds、name、normalizedName、sort、enabled、deletedAt、treeVersion | ancestorIds 不含自身，根为空；深度为其长度加一 |
| category_names | H(parentId,normalizedName)，categoryId | 同级名称占位；改名迁父和删除同步处理 |
| questions | questionId，categoryId、currentVersionId、status、importBatchId | 组织归属，不作为计分归属 |
| question_versions | versionId，questionId、type、stem、options、answer、analysis、assetIds、defaultPoints | 服务端私有；发布引用后不可覆盖 |
| papers | paperId，title、categoryId、access、difficulty、sort、publishedAt、status、activeVersionId、revision、importBatchId | access 为 free、vip；difficulty 为 beginner、intermediate、challenge（入门、进阶、挑战）；发布后冻结；categoryId 可受控迁移 |
| paper_versions | versionId，paperId、questionCount、maxScore、chunkIds、answerChunkIds、categoryPathSnapshot、manifestHash | 不可变；先写完整块再切换 activeVersionId |
| paper_chunks | H(versionId,chunkNo)，items 中只含题干选项分值及题面素材 | 单块最多 20 题且序列化不超过 256 KiB |
| paper_answers | H(versionId,chunkNo)，题目版本标识、答案、解析和解析素材 | 不随答题接口输出 |
| media_assets | assetId，fileId、kind、mime、size、sha256、state、uploader | kind 区分 prompt、analysis；state 必须 ready 才能发布 |

父级查找不能只信任客户端传入的 ancestorIds。服务端遍历目标祖先并检验树的完整性，移动子树按最长后代深度检查。删除是逻辑删除，保留已发布快照中的路径；所有当前题目和试卷引用应先迁至有效类目。

paper_versions 的块清单包含每块摘要；发布之前验证题数、满分、题序和所有块闭合。为了满足 100 题上限又不在事务里读 100 条题目，将冻结题面及答案分块。评分可在事务外读取不可变答案块，但事务内复核版本有效状态与摘要引用。

## 4 答题与分数

| 集合 | 主键及核心字段 | 关键规则 |
| --- | --- | --- |
| attempts | attemptId，memberId、paperId、paperVersionId、answers、draftRevision、state、submittedAt、score、gradeRevision、submitHash | state 为 inProgress、submitted、abandoned；答案选项集合规范排序 |
| paper_bests | H(memberId,paperId)，bestScore、bestAttemptId、firstReachedAt、revision | 跨卷版本只算同一 paperId 一个最高分 |
| score_events | H(attemptId,gradeRevision)，memberId、paperId、scoreSeq、delta、submittedAt、weekKey、monthKey、kind | 原交卷事件只追加；纠错补偿引用旧事件，不覆盖证据 |
| score_metrics | H(metricGeneration,scope,periodKey,categoryId,memberId)，metricGeneration、scope、periodKey、categoryId、memberId、value、reachedAt、revision | 总榜、周榜、月榜及每级分类的个人指标 |
| medal_grants | H(memberId,medalId)，awardedAt、sourceId、revokedAt、reason | 重放不重复授予 |
| ranking_heads | H(scope,periodKey,categoryId)，generation、sampleStartedAt、sampleEndedAt、catalogVersion、status | 只指向完整快照 |
| ranking_rows | H(boardId,generation,memberId)，boardId、generation、memberId、value、rank、sortOrdinal | 用于榜单页及本人名次；不存 openId |
| jobs | jobId，type、businessKey、state、cursor、leaseUntil、fencingToken、attempts、lastError | 持久任务；同业务键确定性 ID，租约过期可受控接续 |
| idempotency | H(actorId,action,key)，payloadHash、status、resultRef | 相同键不同摘要报冲突；不能盲目复用旧成功 |

scope 只允许 total、category、week、month。periodKey 对累计榜为 all，对周榜为北京时间周一的 YYYY-MM-DD，对月榜为 YYYY-MM。周键使用周一起始日期避免跨年 ISO 周号歧义。categoryId 仅分类榜必填。不存在免费或付费分榜字段。total、week、month 的 metricGeneration 固定为 base；category 使用 catalog.categoryMetricsGeneration，迁移重建先写新 generation 后切换指针。累计类目之外的 categoryId 统一为空字符串。

每个有效新增分同时更新 total、week、month 和最多三个祖先含自身 category 指标，但 member_stats.totalScore 只加一次。每会员 scoreSeq 随交卷原子递增，用于重算排序和排查，不作为全站全局热点计数器。

## 5 交易与权益

| 集合 | 主键及核心字段 | 关键规则 |
| --- | --- | --- |
| vip_plans | planId，version、title、durationSeconds、priceFen、productIds、enabled | 每渠道映射准确；旧订单锁定旧商品参数 |
| orders | orderId，memberId、planSnapshot、amountFen、channel、payState、grantState、refundState、expiresAt、paidAt | payState 为 pending、confirming、paid、closed；grantState 为 pending、processing、granted、error、revokedRemaining；refundState 为 none、requested、processing、succeeded、failed；三个状态维度分开；没有成功支付时不应出现已发放 |
| payment_receipts | H(provider,environment,transactionId)，orderId、verifiedAt、amountFen、eventDigest | 平台交易号唯一，避免可空唯一索引 |
| callback_events | H(provider,stableEventKey)，type、orderId、payloadDigest、status | 不同通知编号亦需由交易号和订单最终幂等 |
| refunds | refundId，orderId、requestedFen、confirmedFen、state、channelRef | 商户请求与平台最终成功分别记录 |
| vip_accounts | memberId，expiresAt、revision、queueVersion、reconcileState | 唯一账户串行点，派生摘要 |
| vip_grants | H(sourceType,sourceId)，memberId、grantedSeconds、remainingSeconds、consumedSeconds、sequence、revokedSeconds | 一订单一来源；退款不伤害其他来源 |
| vip_events | eventId，memberId、sourceId、type、effectiveAt、seconds、accountRevision | 追加事件账本，可重建账户摘要 |
| payment_sessions | sessionId，memberId、openidHash、encryptedSessionKey、expiresAt | 短期受保护资料，禁止入普通日志；按需失效清理 |

持续消费无需每秒写数据库。账户读取根据已结算时刻和可用时长推算，到发放或退款时结算已用部分。订单多到不能在一个事务中处理时使用带账户租约的分批重建，完成前禁止该账户新发放并显示处理中，查询原有可用权益遵循最后已提交版本；支付通知照常持久接收。

订单号、refundId 等传给渠道前，映射为符合渠道格式的独立业务编号并唯一存储；不假定任意数据库 ID 能直接用于所有支付 API。

## 6 导入与文件

| 集合 | 关键字段 | 约束 |
| --- | --- | --- |
| import_batches | batchId、fileHash、kind、state、rowCount、validationHash、catalogVersion、committedAt | state 为 uploaded、validated、staging、committed、failed |
| import_rows | H(batchId,rowNo)，normalizedData、errors、targetId | 暂存，不成为用户可见内容 |
| source_keys | H(kind,sourceKey)，targetId、batchId、state | 来源键占位，冲突不覆盖 |
| upload_tickets | ticketId、tokenHash、adminUid、purpose、maxBytes、expiresAt、state、objectKey | 一次性，首版 10 分钟有效；明文票据不入日志 |

批次内确定性 ID 确保分批写入重放不重复。草稿记录带 importBatchId，所有后台列表和按 ID 读取都需批次 committed 才视为有效，不能只过滤列表而让按 ID 读取暴露半成品。

## 7 必需索引

以下是业务索引定义，正式部署生成对应 CloudBase 配置；所有组合字段顺序均需按目标查询验证。

| 集合 | 字段顺序 | 查询用途 |
| --- | --- | --- |
| categories | parentId ASC、deletedAt ASC、sort ASC、_id ASC | 子节点列表；树维护 |
| questions | categoryId ASC、status ASC、updatedAt DESC、_id ASC | 后台题库 |
| papers | status ASC、categoryId ASC、publishedAt DESC、_id ASC | 分类最新卷 |
| papers | status ASC、sort ASC、_id ASC | 推荐卷 |
| attempts | memberId ASC、state ASC、submittedAt DESC、_id ASC | 本人历史 |
| attempts | paperId ASC、state ASC、_id ASC | 纠错分页 |
| paper_bests | memberId ASC、paperId ASC | 个人分类重建 |
| score_events | memberId ASC、paperId ASC、scoreSeq ASC | 重评分差 |
| score_metrics | metricGeneration ASC、scope ASC、periodKey ASC、categoryId ASC、value DESC、reachedAt ASC、memberId ASC | 榜单源数据 |
| ranking_rows | boardId ASC、generation ASC、sortOrdinal ASC | 榜单游标分页 |
| orders | memberId ASC、createdAt DESC、_id ASC | 本人订单 |
| orders | payState ASC、nextCheckAt ASC、_id ASC | 查单补偿 |
| vip_grants | memberId ASC、sequence ASC | 权益来源顺序 |
| jobs | state ASC、nextRunAt ASC、_id ASC | 工作器认领 |
| import_rows | batchId ASC、rowNo ASC | 导入校验与分块 |
| audit_logs | target ASC、createdAt DESC、_id ASC | 对象操作历史 |

上述索引查询涉及的字段应全部赋确定值，不混用缺失和 null。access 筛选只用于试卷列表，按真实查询计划增补索引，不为所有条件组合盲建索引。

CloudBase 支持组合与唯一索引，但唯一索引字段缺失会按 null 参与唯一性判断；因此支付交易号等未付款时不存在的值单独进入 receipts 集合，而非给所有 orders 建可空唯一索引。[索引管理](https://docs.cloudbase.net/database/data-index)

## 8 校验和迁移约束

首次发布前校验集合、权限、主键冲突及索引，不以集合为空推断权限正确。业务升级先加字段、兼容读写，再回填；禁止直接把旧成绩删掉重算冒充迁移。

不可变快照、事件与订单原始参数保留，逻辑删除不等于物理清除。数据保留期依据实际运营和隐私方案落实；没有明确策略前不部署自动删除业务证据的定时器。

详细原子边界、排行快照和结构调整见[一致性流程](consistency-v1.0.md)，支付细节见[支付技术方案](../operations/payment-v1.0.md)。
