from __future__ import annotations

import argparse
from pathlib import Path
from textwrap import dedent
from typing import Sequence


DEFAULT_SERVERS = {
    "svg": "https://www.plantuml.com/plantuml/svg/",
    "png": "https://www.plantuml.com/plantuml/png/",
}


def clean_uml(source: str) -> str:
    return dedent(source).strip() + "\n"


def render_plantuml(source: str, output_path: Path, server: str) -> None:
    try:
        import plantuml
    except ImportError as exc:
        raise SystemExit(
            "未找到 plantuml 库或其依赖。请先运行：venv\\Scripts\\python.exe -m pip install plantuml six"
        ) from exc

    client = plantuml.PlantUML(url=server)
    try:
        output_path.write_bytes(client.processes(source))
    except Exception as exc:
        raise RuntimeError(f"PlantUML 渲染失败：{output_path.name}") from exc


def write_latex_snippet(out_dir: Path, files: Sequence[str]) -> None:
    captions = {
        "use_case_diagram": "系统用例图",
        "class_diagram": "系统概念类图",
        "activity_daily_puzzle": "每日谜题答题活动图",
        "activity_borrow": "借阅流程活动图",
        "activity_commission": "事件委托活动图",
        "state_borrow_asset": "借阅物资状态机图",
        "module_dependency": "功能模块依赖图",
    }
    lines = [
        "% 将下面内容复制到 main.tex 的功能性需求章节即可引用生成的 UML 图。",
        "% 若当前 LaTeX 编译链不直接支持 SVG，可先将 SVG 转为 PDF/PNG 后再修改文件后缀。",
        "",
    ]
    for filename in files:
        label = Path(filename).stem.replace("_", "-")
        lines.extend(
            [
                "\\begin{figure}[H]",
                "    \\centering",
                f"    \\includegraphics[width=0.95\\textwidth]{{uml_output/{filename}}}",
                f"    \\caption{{{captions.get(Path(filename).stem, filename)}}}",
                f"    \\label{{fig:{label}}}",
                "\\end{figure}",
                "",
            ]
        )
    (out_dir / "latex_snippet.tex").write_text("\n".join(lines), encoding="utf-8")


DIAGRAMS: dict[str, str] = {
    "use_case_diagram": clean_uml(
        """
        @startuml
        title nk推协侦探管理系统 - 用例图
        left to right direction
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false
        skinparam usecase {
          BackgroundColor #fff7ed
          BorderColor #344e41
          FontColor #172554
        }
        skinparam actor {
          BorderColor #334155
          FontColor #1f2937
        }

        actor "普通用户/侦探" as User
        actor "管理员/社团管理层" as Admin

        rectangle "系统边界：微信小程序与管理后台" {
          usecase "微信授权登录" as UCLogin
          usecase "每日谜题答题" as UCPuzzle
          usecase "查看积分榜" as UCRank
          usecase "兑换积分商品" as UCShop
          usecase "活动报名/取消" as UCActivity
          usecase "提交反馈建议" as UCFeedback
          usecase "维护侦探名片" as UCCard
          usecase "借阅剧本/书籍" as UCBorrow
          usecase "浏览推荐内容" as UCRecommend
          usecase "Dud关键词互动" as UCDud
          usecase "发布事件委托" as UCPost
          usecase "接收/完成委托" as UCAccept

          usecase "预设每日谜题" as AdminPuzzle #ecfeff
          usecase "配置Dud回复规则" as AdminDud #ecfeff
          usecase "确认借阅流转" as AdminBorrow #ecfeff
          usecase "维护库存/商城" as AdminInventory #ecfeff
          usecase "维护活动参数" as AdminActivity #ecfeff
          usecase "查看反馈与审计" as AdminAudit #ecfeff
        }

        User --> UCLogin
        User --> UCPuzzle
        User --> UCRank
        User --> UCShop
        User --> UCActivity
        User --> UCFeedback
        User --> UCCard
        User --> UCBorrow
        User --> UCRecommend
        User --> UCDud
        User --> UCPost
        User --> UCAccept

        Admin --> AdminPuzzle
        Admin --> AdminDud
        Admin --> AdminBorrow
        Admin --> AdminInventory
        Admin --> AdminActivity
        Admin --> AdminAudit
        Admin --|> User

        UCPuzzle ..> UCLogin : <<include>>
        UCShop ..> UCLogin : <<include>>
        UCBorrow ..> UCLogin : <<include>>
        UCPost ..> UCLogin : <<include>>
        UCAccept ..> UCPost : <<extend>>
        AdminBorrow ..> UCBorrow : <<include>>
        AdminInventory ..> UCShop : <<include>>

        note bottom
          普通用户通过微信授权进入核心业务；
          管理员继承普通用户权限，并额外维护谜题、规则、库存、活动与借阅状态。
        end note
        @enduml
        """
    ),
    "class_diagram": clean_uml(
        """
        @startuml
        title nk推协侦探管理系统 - 概念类图
        top to bottom direction
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false
        skinparam classAttributeIconSize 0

        class "User 用户" as User {
          + openId: String
          + nickname: String
          + role: Role
          + campus: String
          + login()
          + updateProfile()
        }

        class "Admin 管理员" as Admin {
          + whitelist: Boolean
          + permissions: List
          + checkPermission()
          + auditOperation()
        }

        class "DailyPuzzle 每日谜题" as Puzzle {
          + title: String
          + options: List
          + answer: String
          + publishAt: DateTime
          + isAvailable()
          + checkAnswer()
        }

        class "AnswerRecord 答题记录" as Answer {
          + userId: String
          + puzzleId: String
          + selected: String
          + correct: Boolean
          + ensureOncePerDay()
          + revealAnalysis()
        }

        class "CreditAccount 积分账户" as Credit {
          + totalCredit: Int
          + exchangeableCredit: Int
          + rank: Int
          + addPuzzleCredit()
          + transfer()
          + deductForExchange()
        }

        class "ShopItem 兑换商品" as Shop {
          + name: String
          + requiredCredit: Int
          + stock: Int
          + exchange()
          + decreaseStock()
        }

        class "Activity 活动" as Activity {
          + title: String
          + time: DateTime
          + location: String
          + capacity: Int
          + canRegister()
          + canCancel()
        }

        class "Registration 报名记录" as Registration {
          + userId: String
          + activityId: String
          + status: String
          + register()
          + cancelBeforeDeadline()
        }

        class "AssetItem 物资" as Asset {
          + name: String
          + category: String
          + campus: String
          + status: AssetStatus
          + applyBorrow()
          + markBorrowed()
          + returnToStock()
        }

        class "BorrowRecord 借阅记录" as Borrow {
          + borrowerId: String
          + assetId: String
          + state: BorrowState
          + cancelInTransit()
          + confirmBorrowed()
        }

        class "ReplyRule Dud回复规则" as Dud {
          + keywords: List
          + matchMode: Enum
          + replyText: String
          + matchMessage()
          + updateRule()
        }

        class "DetectiveCard 侦探名片" as Card {
          + userId: String
          + bio: String
          + style: String
          + editCard()
          + viewCard()
        }

        class "CommissionPost 事件委托" as Post {
          + publisherId: String
          + reward: Int
          + status: String
          + accept()
          + resolve()
          + distributeReward()
        }

        class "Feedback 反馈建议" as Feedback {
          + authorId: String?
          + content: String
          + anonymous: Boolean
          + submit()
          + markHandled()
        }

        class "Recommendation 推荐内容" as Recommendation {
          + title: String
          + type: String
          + recommender: String
          + reasonUrl: String
          + publish()
          + viewDetail()
        }

        Admin --|> User : 继承/扩展权限
        User "1" --> "*" Answer
        Puzzle "1" --> "*" Answer
        User "1" --> "1" Credit
        Credit --> Shop : 兑换扣减
        User "1" --> "*" Registration
        Activity "1" --> "*" Registration
        Asset "1" --> "*" Borrow
        User "1" --> "*" Borrow : 借阅人
        Admin --> Asset : 维护库存
        Admin --> Puzzle : 维护谜题
        Admin --> Dud : 维护规则
        User --> Card : 拥有
        User --> Post : 发布/接收
        Credit --> Post : 积分报酬
        User --> Feedback : 提交
        Admin --> Feedback : 处理
        Admin --> Recommendation : 发布
        @enduml
        """
    ),
    "activity_daily_puzzle": clean_uml(
        """
        @startuml
        title 每日谜题答题活动图
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false

        start
        :进入每日谜题页面;
        :检查微信登录状态;
        if (是否已登录？) then (否)
          :跳转授权登录;
        else (是)
        endif
        :加载今日谜题;
        if (今日是否已答？) then (是)
          :展示历史结果与解析;
        else (否)
          :提交选项并校验;
          if (是否答对？) then (是)
            :增加个人积分;
          else (否)
          endif
          :显示正确答案和解析;
          :写入答题记录;
        endif
        stop
        @enduml
        """
    ),
    "activity_borrow": clean_uml(
        """
        @startuml
        title 剧本杀/书籍借阅活动图
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false

        start
        :用户进入借阅页面;
        :浏览库存与所在校区;
        if (物资是否在库？) then (否)
          :仅展示状态：借出/传递中;
          stop
        else (是)
          :用户提交借阅申请;
          :状态改为传递中;
        endif
        if (社团管理层是否确认？) then (取消)
          :借阅人取消申请;
        else (确认)
          :管理员确认实物借出;
        endif
        :更新借阅记录与物资状态;
        stop
        @enduml
        """
    ),
    "activity_commission": clean_uml(
        """
        @startuml
        title 事件委托/调查活动图
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false

        start
        :发帖人创建求助贴;
        :设置积分报酬;
        if (可兑换积分足够？) then (否)
          :提示积分不足;
          stop
        else (是)
          :冻结/预扣报酬积分;
        endif
        :其他侦探接收委托;
        :发帖人确认解决;
        :向接收者分配积分;
        :记录交易历史;
        stop
        @enduml
        """
    ),
    "state_borrow_asset": clean_uml(
        """
        @startuml
        title 借阅物资状态机图
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false

        state "维护/下架" as Maintenance

        [*] --> 在库
        在库 --> 传递中 : 用户申请
        传递中 --> 已借出 : 管理员确认
        传递中 --> 在库 : 借阅人取消
        已借出 --> 在库 : 归还入库
        在库 --> Maintenance : 管理员下架
        Maintenance --> 在库 : 恢复上架

        note bottom of 传递中
          约束：传递中状态下，只有借阅人可取消；
          其他用户只能看到状态，不可再次借阅。
        end note
        @enduml
        """
    ),
    "module_dependency": clean_uml(
        """
        @startuml
        title 功能模块依赖图
        left to right direction
        skinparam backgroundColor #f8fafc
        skinparam defaultFontName Microsoft YaHei
        skinparam shadowing false
        skinparam componentStyle rectangle

        component "登录与权限" as Auth #dbeafe
        component "每日谜题" as Puzzle #fff7ed
        component "积分账户" as Credit #ecfdf5
        component "排行榜" as Rank #fef3c7
        component "积分商城" as Shop #ecfdf5
        component "库存管理" as Inventory #e0f2fe
        component "借阅系统" as Borrow #fff7ed
        component "活动报名" as Activity #fce7f3
        component "事件委托" as Commission #ede9fe
        component "Dud关键词回复" as Dud #cffafe
        component "推荐/反馈/名片" as Profile #f1f5f9

        Auth --> Puzzle : 授权
        Puzzle --> Credit : 答对加分
        Credit --> Rank : 累计积分
        Credit --> Shop : 可兑换积分
        Shop --> Inventory : 库存扣减
        Borrow --> Inventory : 物资状态
        Auth --> Activity : 身份校验
        Auth --> Borrow : 身份校验
        Commission --> Credit : 报酬转移
        Dud --> Auth : 频率限制
        Profile --> Auth : 用户资料

        note bottom
          模块依赖图用于辅助后续架构设计，
          突出权限、积分与库存三个共享核心。
        end note
        @enduml
        """
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate UML diagrams through the plantuml Python library.")
    parser.add_argument("-o", "--output", default="uml_output", help="output directory, default: uml_output")
    parser.add_argument(
        "--format",
        choices=sorted(DEFAULT_SERVERS),
        default="svg",
        help="rendered diagram format, default: svg",
    )
    parser.add_argument(
        "--server",
        default=None,
        help="PlantUML server URL. If omitted, use the default server for the selected format.",
    )
    parser.add_argument(
        "--write-only",
        action="store_true",
        help="only write .puml sources and latex snippet, do not call PlantUML server",
    )
    args = parser.parse_args()
    server = args.server or DEFAULT_SERVERS[args.format]

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    generated: list[str] = []
    for name, source in DIAGRAMS.items():
        puml_path = out_dir / f"{name}.puml"
        image_path = out_dir / f"{name}.{args.format}"
        puml_path.write_text(source, encoding="utf-8")
        if not args.write_only:
            render_plantuml(source, image_path, server)
        generated.append(image_path.name)

    write_latex_snippet(out_dir, generated)

    print("Generated UML files:")
    for filename in generated:
        print(f" - {out_dir / filename}")
        print(f" - {out_dir / Path(filename).with_suffix('.puml')}")
    print(f" - {out_dir / 'latex_snippet.tex'}")


if __name__ == "__main__":
    main()
