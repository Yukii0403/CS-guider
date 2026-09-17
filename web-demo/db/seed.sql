-- ============================================================================
-- 种子数据：领域树 + 五级知识树骨架
-- ============================================================================
-- 执行： npx wrangler d1 execute academic-nav-kb --remote --file=db/seed.sql
--
-- ★ 这里只种「结构」，不种「掌握状态」。
--   所有 nodes.status 都是 NULL（未评估）。理由：
--   能力状态必须由证据产生（用户贴代码、说学过什么），预置一份假的掌握度
--   等于把产品最核心的承诺（结论可追溯）从第一步就破坏了。
--   演示时走一遍「贴代码 → 反推 → 确认卡片 → 落库」比看到一堆现成状态更有说服力。
--
-- nodes 的树骨架是「手工建第一层、其余结构预置」这一设计决策的产物；
-- 真实使用中新增节点由 AI 提议、走 lib/changeset.js 的查重后落库。
-- ============================================================================

-- ---------------------------------------------------------------- 元信息
INSERT OR IGNORE INTO meta(key,value,updated_at) VALUES('schema_version','1','2026-09-17T00:00:00Z');
INSERT OR IGNORE INTO meta(key,value,updated_at) VALUES('synced_at','2026-09-17T00:00:00Z','2026-09-17T00:00:00Z');
INSERT OR IGNORE INTO meta(key,value,updated_at) VALUES('seeded_at','2026-09-17T00:00:00Z','2026-09-17T00:00:00Z');

-- ---------------------------------------------------------------- domains
-- 领域树第一层 10 个节点。这是「选项式追问」的唯一来源 —— AI 出选项只能从这里取。
INSERT OR IGNORE INTO domains(id,name,name_norm,aliases,parent_id,level,arxiv_categories,keywords,source,created_at) VALUES
('cv','计算机视觉','计算机视觉','["CV","computer vision","视觉","机器视觉"]',NULL,1,'["cs.CV"]','["图像","视频","检测","分割","重建"]','seed','2026-09-17T00:00:00Z'),
('nlp','自然语言处理','自然语言处理','["NLP","natural language processing","自然语言","文本处理"]',NULL,1,'["cs.CL"]','["语言","文本","翻译","对话"]','seed','2026-09-17T00:00:00Z'),
('multimodal','多模态','多模态','["multimodal","跨模态","视觉语言","vision-language"]',NULL,1,'["cs.CV","cs.CL","cs.MM"]','["图文","跨模态","视觉语言","检索"]','seed','2026-09-17T00:00:00Z'),
('generative','生成模型','生成模型','["generative models","AIGC","生成式","扩散模型"]',NULL,1,'["cs.LG","cs.CV"]','["生成","扩散","GAN","可控生成"]','seed','2026-09-17T00:00:00Z'),
('rl','强化学习与决策','强化学习与决策','["RL","reinforcement learning","强化学习","决策"]',NULL,1,'["cs.LG","cs.AI"]','["策略","价值函数","机器人"]','seed','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO domains(id,name,name_norm,aliases,parent_id,level,arxiv_categories,keywords,source,created_at) VALUES
('speech','语音与音频','语音与音频','["speech","audio","语音","音频"]',NULL,1,'["eess.AS","cs.SD"]','["语音识别","合成","音频"]','seed','2026-09-17T00:00:00Z'),
('graph','图与推荐','图与推荐','["graph learning","recommender systems","图神经网络","推荐系统","GNN"]',NULL,1,'["cs.SI","cs.IR","cs.LG"]','["图","推荐","知识图谱"]','seed','2026-09-17T00:00:00Z'),
('theory','机器学习理论','机器学习理论','["ML theory","learning theory","学习理论","统计学习"]',NULL,1,'["cs.LG","stat.ML"]','["泛化","优化理论","因果"]','seed','2026-09-17T00:00:00Z'),
('agent','智能体','智能体','["agent","LLM agent","智能代理","AI Agent"]',NULL,1,'["cs.AI","cs.CL"]','["工具调用","规划","多智能体","记忆"]','seed','2026-09-17T00:00:00Z'),
('ai4science','AI4Science','ai4science','["AI for science","科学智能","AI4S"]',NULL,1,'["cs.LG","q-bio.BM","physics.comp-ph"]','["蛋白质","分子","科学计算","材料"]','seed','2026-09-17T00:00:00Z');

-- ---------------------------------------------------------------- nodes L1
INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_math',NULL,1,'数学基础','数学基础','做这个方向需要哪些数学','数学基础','[]','2026-09-17T00:00:00Z'),
('n_code',NULL,1,'编程基础','编程基础','语言与工程能力','编程基础','[]','2026-09-17T00:00:00Z'),
('n_theory',NULL,1,'理论基础','理论基础','算法、架构与领域知识','理论基础','[]','2026-09-17T00:00:00Z'),
('n_tool',NULL,1,'工具基础','工具基础','框架、库与工程工具','工具基础','[]','2026-09-17T00:00:00Z'),
('n_research',NULL,1,'科研素养','科研素养','论文阅读、实验设计与写作','科研素养','[]','2026-09-17T00:00:00Z'),
('n_math_la','n_math',2,'线性代数','线性代数','矩阵、向量空间与分解','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_prob','n_math',2,'概率统计','概率统计','不确定性的语言','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_opt','n_math',2,'微积分与优化','微积分与优化','模型怎么被训练出来','数学基础','[]','2026-09-17T00:00:00Z'),
('n_code_py','n_code',2,'Python','python','科研最常用的语言','编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds','n_code',2,'数据结构与算法','数据结构与算法','写得出、也读得懂别人的代码','编程基础','[]','2026-09-17T00:00:00Z');

-- ---------------------------------------------------------------- nodes L2/L3
INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_theory_ml','n_theory',2,'机器学习','机器学习','从数据里学规律','理论基础','[]','2026-09-17T00:00:00Z'),
('n_theory_dl','n_theory',2,'深度学习','深度学习','用神经网络学表示','理论基础','["cv","nlp","multimodal"]','2026-09-17T00:00:00Z'),
('n_tool_pt','n_tool',2,'PyTorch','pytorch','最主流的深度学习框架','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_chain','n_tool',2,'实验工具链','实验工具链','让实验能被别人重跑出来','工具基础','[]','2026-09-17T00:00:00Z'),
('n_research_reading','n_research',2,'论文阅读','论文阅读','怎么读得快、读得准','科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_exp','n_research',2,'实验设计','实验设计','让结论站得住','科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_write','n_research',2,'学术写作','学术写作','把做过的事说清楚','科研素养','[]','2026-09-17T00:00:00Z'),
('n_math_la_space','n_math_la',3,'向量空间与矩阵','向量空间与矩阵',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_decomp','n_math_la',3,'矩阵分解','矩阵分解',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_prob_basic','n_math_prob',3,'概率论基础','概率论基础',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_opt_grad','n_math_opt',3,'梯度与优化','梯度与优化',NULL,'数学基础','[]','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_code_py_sci','n_code_py',3,'科学计算','科学计算',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_tree','n_code_ds',3,'树与图','树与图',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_sort','n_code_ds',3,'排序与查找','排序与查找',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_theory_ml_basic','n_theory_ml',3,'机器学习基础','机器学习基础',NULL,'理论基础','[]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm','n_theory_dl',3,'多模态学习','多模态学习','让模型同时处理图和文','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_cv','n_theory_dl',3,'计算机视觉','计算机视觉',NULL,'理论基础','["cv"]','2026-09-17T00:00:00Z'),
('n_tool_pt_model','n_tool_pt',3,'模型构建','模型构建',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_train','n_tool_pt',3,'训练流程','训练流程',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_gpu','n_tool_pt',3,'GPU 与加速','gpu 与加速',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_chain_env','n_tool_chain',3,'环境与依赖','环境与依赖',NULL,'工具基础','[]','2026-09-17T00:00:00Z');

-- ---------------------------------------------------------------- nodes L4
INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_math_la_space_op','n_math_la_space',4,'矩阵与向量运算','矩阵与向量运算',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_decomp_svd','n_math_la_decomp',4,'特征分解与 SVD','特征分解与 svd',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_prob_basic_rv','n_math_prob_basic',4,'随机变量与分布','随机变量与分布',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_opt_grad_basic','n_math_opt_grad',4,'梯度方法','梯度方法',NULL,'数学基础','[]','2026-09-17T00:00:00Z'),
('n_code_py_numpy','n_code_py_sci',4,'NumPy','numpy',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_tree_bt','n_code_ds_tree',4,'二叉树','二叉树',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_sort_basic','n_code_ds_sort',4,'基础排序算法','基础排序算法',NULL,'编程基础','[]','2026-09-17T00:00:00Z'),
('n_theory_ml_basic_train','n_theory_ml_basic',4,'训练与评估','训练与评估',NULL,'理论基础','[]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_retrieval','n_theory_dl_mm',4,'图文检索','图文检索','给一句话，从图库里找最匹配的图','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_vlm','n_theory_dl_mm',4,'视觉语言模型','视觉语言模型',NULL,'理论基础','["multimodal"]','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_theory_dl_cv_basic','n_theory_dl_cv',4,'图像分类基础','图像分类基础',NULL,'理论基础','["cv"]','2026-09-17T00:00:00Z'),
('n_tool_pt_module','n_tool_pt_model',4,'nn.Module','nn.module',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_loop','n_tool_pt_train',4,'训练循环','训练循环',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_gpu_dev','n_tool_pt_gpu',4,'设备管理','设备管理',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_chain_env_req','n_tool_chain_env',4,'requirements 与虚拟环境','requirements 与虚拟环境',NULL,'工具基础','[]','2026-09-17T00:00:00Z'),
('n_research_reading_method','n_research_reading',3,'阅读方法','阅读方法',NULL,'科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_reading_three','n_research_reading_method',4,'三遍读法','三遍读法',NULL,'科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_exp_design','n_research_exp',3,'实验方法','实验方法',NULL,'科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_exp_ablation','n_research_exp_design',4,'消融实验','消融实验',NULL,'科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_write_structure','n_research_write',3,'论文结构','论文结构',NULL,'科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_write_abs','n_research_write_structure',4,'摘要与引言','摘要与引言','第一段决定读者要不要继续读下去','科研素养','[]','2026-09-17T00:00:00Z');
-- ---------------------------------------------------------------- nodes L5（知识点：状态挂在这一层）
INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_math_la_mul','n_math_la_space_op',5,'矩阵乘法','矩阵乘法','维度的对齐方式是所有报错的来源','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_cos','n_math_la_space_op',5,'内积与余弦相似度','内积与余弦相似度','检索里排序靠的就是它','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_norm','n_math_la_space_op',5,'范数与归一化','范数与归一化','L2 归一化后内积等于余弦相似度','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_eig','n_math_la_decomp_svd',5,'特征值分解','特征值分解','方阵的固有方向','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_la_svd','n_math_la_decomp_svd',5,'奇异值分解（SVD）','奇异值分解（svd）','任意矩阵的低秩近似','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_prob_bayes','n_math_prob_basic_rv',5,'条件概率与贝叶斯公式','条件概率与贝叶斯公式','先验如何被证据更新','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_prob_dist','n_math_prob_basic_rv',5,'常见概率分布','常见概率分布','正态、伯努利、类别分布','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_opt_gd','n_math_opt_grad_basic',5,'梯度下降与学习率','梯度下降与学习率','最朴素的优化方法','数学基础','[]','2026-09-17T00:00:00Z'),
('n_math_opt_adam','n_math_opt_grad_basic',5,'Adam 优化器','adam 优化器','实际项目里的默认选择','数学基础','[]','2026-09-17T00:00:00Z'),
('n_code_py_numpy_tensor','n_code_py_numpy',5,'张量操作与广播','张量操作与广播','广播规则决定运算结果','编程基础','[]','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_code_py_numpy_einsum','n_code_py_numpy',5,'einsum 与张量缩并','einsum 与张量缩并','复杂张量运算的通用写法','编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_tree_trav','n_code_ds_tree_bt',5,'二叉树的遍历','二叉树的遍历','递归与非递归两种写法','编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_sort_qs','n_code_ds_sort_basic',5,'快速排序','快速排序','能手写划分过程','编程基础','[]','2026-09-17T00:00:00Z'),
('n_code_ds_sort_bs','n_code_ds_sort_basic',5,'二分查找','二分查找','边界条件最容易写错','编程基础','[]','2026-09-17T00:00:00Z'),
('n_theory_ml_overfit','n_theory_ml_basic_train',5,'过拟合与正则化','过拟合与正则化','能过拟合小数据是管线正确的证据','理论基础','[]','2026-09-17T00:00:00Z'),
('n_theory_ml_eval','n_theory_ml_basic_train',5,'评估指标与验证集','评估指标与验证集','指标选错等于结论错','理论基础','[]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_infonce','n_theory_dl_mm_retrieval',5,'对比学习与 InfoNCE','对比学习与 infonce','正负样本对上的交叉熵','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_tower','n_theory_dl_mm_retrieval',5,'双塔模型','双塔模型','图与文各自编码后算相似度','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_hardneg','n_theory_dl_mm_retrieval',5,'难负样本挖掘','难负样本挖掘','决定检索模型上限的一步','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_metric','n_theory_dl_mm_retrieval',5,'检索评价指标 Recall@K 与 mAP','检索评价指标 recall@k 与 map','必须自己写一遍才知道坑在哪','理论基础','["multimodal"]','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_theory_dl_mm_clip','n_theory_dl_mm_vlm',5,'CLIP 的训练目标','clip 的训练目标','对称对比损失的经典实现','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_mm_prompt','n_theory_dl_mm_vlm',5,'提示学习与零样本迁移','提示学习与零样本迁移','不微调也能换任务','理论基础','["multimodal"]','2026-09-17T00:00:00Z'),
('n_theory_dl_cv_cnn','n_theory_dl_cv_basic',5,'卷积神经网络','卷积神经网络','局部连接与权值共享','理论基础','["cv"]','2026-09-17T00:00:00Z'),
('n_theory_dl_cv_aug','n_theory_dl_cv_basic',5,'数据增强','数据增强','小数据集上最有效的正则','理论基础','["cv"]','2026-09-17T00:00:00Z'),
('n_tool_pt_module_custom','n_tool_pt_module',5,'自定义网络结构与前向','自定义网络结构与前向','__init__ 与 forward 的分工','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_module_init','n_tool_pt_module',5,'参数初始化','参数初始化','初始化不好再怎么调都白搭','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_loop_loss','n_tool_pt_loop',5,'损失函数与反向传播','损失函数与反向传播','loss.backward() 前后发生了什么','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_loop_opt','n_tool_pt_loop',5,'优化器与梯度清零','优化器与梯度清零','zero_grad 的位置很容易写反','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_loop_data','n_tool_pt_loop',5,'DataLoader 与批处理','dataloader 与批处理','把数据喂进训练循环','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_pt_gpu_migrate','n_tool_pt_gpu_dev',5,'张量与模型迁移到 GPU','张量与模型迁移到 gpu','只 .cuda() 模型、忘了数据是常见错误','工具基础','[]','2026-09-17T00:00:00Z');

INSERT OR IGNORE INTO nodes(id,parent_id,level,name,name_norm,summary,category,domain_ids,updated_at) VALUES
('n_tool_pt_gpu_amp','n_tool_pt_gpu_dev',5,'混合精度训练','混合精度训练','显存不够时的第一选择','工具基础','[]','2026-09-17T00:00:00Z'),
('n_tool_chain_env_req_pin','n_tool_chain_env_req',5,'固定版本与可复现安装','固定版本与可复现安装','requirements.txt 要写死版本号','工具基础','[]','2026-09-17T00:00:00Z'),
('n_research_reading_three_scan','n_research_reading_three',5,'快速判断相关性','快速判断相关性','五分钟决定这篇要不要读','科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_reading_three_note','n_research_reading_three',5,'精读与复现笔记','精读与复现笔记','笔记要能支撑复现','科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_exp_ablation_run','n_research_exp_ablation',5,'消融实验设计','消融实验设计','证明每一处改动都有用','科研素养','[]','2026-09-17T00:00:00Z'),
('n_research_exp_seed','n_research_exp_ablation',5,'随机种子与可复现性','随机种子与可复现性','跑三次结果差很多说明有问题','科研素养','[]','2026-09-17T00:00:00Z');
