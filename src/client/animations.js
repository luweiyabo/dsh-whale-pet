// 每次 DSH factory 调用都创建独立状态，避免注册表与缓存跨实例共享。
export function createAnimationCatalog() {
    // ============================================================================
    // 动画目录（animation catalog）—— 所有动画的"事实来源"
    // ============================================================================
    // 资源文件：assets/thumb/<语义分类>/<英文 id>.webm（基础分类与日常、工作、节日、
    // 美食、游戏、音乐、魔术、梗图等）。运行时内部与界面动作名均使用英文。
    // 画布几何：thumb 视频是 640×360（16:9）画布，人物"脚底"在 y=330。
    // (360-330)/360 = 8.33%，与母版比例一致——用这个比例做落地对齐，缩放后依然准确。
    var CANVAS_W = 640;
    var CANVAS_H = 360;
    var FEET_Y = 330;

    // 点击/拖拽命中矩形（640×360 像素坐标）。全部动画站立帧 bbox 并集
    // 约为 x:200~440（中心 320）、y:50~335，贴近头顶/脚底。
    var HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };

    // 动画清单：英文 id（文件名/内部标识）+ 英文名称 + 英文描述 + 语义分类（目录）
    var ANIMS = [
        {
            id: 'breathing',
            name: 'Idle Breathing',
            description: '10-second idle breathing animation.',
            nameZh: '待机呼吸休闲',
            descriptionZh: '10 秒桌宠动作：待机呼吸休闲。',
            category: 'idle',
        },
        {
            id: 'looking_around',
            name: 'Looking Around',
            description: '10-second looking around animation.',
            nameZh: '东张西望',
            descriptionZh: '10 秒桌宠动作：东张西望。',
            category: 'turn',
        },
        {
            id: 'floating_steps',
            name: 'Floating Steps',
            description: '10-second floating steps animation.',
            nameZh: '原地漂浮踏步',
            descriptionZh: '10 秒桌宠动作：原地漂浮踏步。',
            category: 'moves',
        },
        {
            id: 'crab_walk',
            name: 'Crab Walk',
            description: '10-second crab walk animation.',
            nameZh: '螃蟹走路',
            descriptionZh: '10 秒桌宠动作：螃蟹走路。',
            category: 'moves',
        },
        {
            id: 'running_trip',
            name: 'Running Trip',
            description: '10-second running trip animation.',
            nameZh: '原地左转奔跑摔跤',
            descriptionZh: '10 秒桌宠动作：原地左转奔跑摔跤。',
            category: 'moves',
        },
        {
            id: 'target_point_run',
            name: 'Target Point Run',
            description: 'Running animation used while moving to a selected screen point.',
            nameZh: '预备姿势奔跑',
            descriptionZh: '点击屏幕选择目标点后，奔跑前往目标位置。',
            category: 'moves',
        },
        {
            id: 'happy_hop',
            name: 'Happy Hop',
            description: '10-second happy hop animation.',
            nameZh: '开心跃动',
            descriptionZh: '10 秒桌宠动作：开心跃动。',
            category: 'clicks',
        },
        {
            id: 'shy_surprise',
            name: 'Shy Surprise',
            description: '10-second shy surprise animation.',
            nameZh: '害羞惊讶',
            descriptionZh: '10 秒桌宠动作：害羞惊讶。',
            category: 'clicks',
        },
        {
            id: 'tsundere_pout',
            name: 'Tsundere Pout',
            description: '10-second tsundere pout animation.',
            nameZh: '傲娇生气',
            descriptionZh: '10 秒桌宠动作：傲娇生气。',
            category: 'clicks',
        },
        {
            id: 'ticklish_giggle',
            name: 'Ticklish Giggle',
            description: '10-second ticklish giggle animation.',
            nameZh: '挠痒咯咯笑',
            descriptionZh: '10 秒桌宠动作：挠痒咯咯笑。',
            category: 'clicks',
        },
        {
            id: 'cheerful_wave',
            name: 'Cheerful Wave',
            description: '10-second cheerful wave animation.',
            nameZh: '元气挥手',
            descriptionZh: '10 秒桌宠动作：元气挥手。',
            category: 'clicks',
        },
        {
            id: 'arrival_wave',
            name: 'Arrival Wave',
            description: 'Greeting animation played after reaching a selected screen point.',
            nameZh: '原地挥手打招呼',
            descriptionZh: '到达选定目标位置后，原地挥手打招呼。',
            category: 'clicks',
        },
        {
            id: 'dragged_in_midair',
            name: 'Dragged in Midair',
            description: '10-second dragged in midair animation.',
            nameZh: '被鼠标拖拽悬空反馈',
            descriptionZh: '10 秒桌宠动作：被鼠标拖拽悬空反馈。',
            category: 'drag',
        },
        {
            id: 'turn_into_ball',
            name: 'Turn Into a Ball',
            description: 'Animation played while the pet is coasting after a fast throw.',
            nameZh: '变成球',
            descriptionZh: '人物被快速甩出后，在惯性滑行与边界反弹期间变成球。',
            category: 'drag',
        },
        {
            id: 'maid_curtsy',
            name: 'Maid Curtsy',
            description: '10-second maid curtsy animation.',
            nameZh: '女仆屈膝礼仪',
            descriptionZh: '10 秒桌宠动作：女仆屈膝礼仪。',
            category: 'daily',
        },
        {
            id: 'big_stretch',
            name: 'Big Stretch',
            description: '10-second big stretch animation.',
            nameZh: '超大伸懒腰',
            descriptionZh: '10 秒桌宠动作：超大伸懒腰。',
            category: 'daily',
        },
        {
            id: 'gentle_spin',
            name: 'Gentle Spin',
            description: '10-second gentle spin animation.',
            nameZh: '小幅度原地旋转展示',
            descriptionZh: '10 秒桌宠动作：小幅度原地旋转展示。',
            category: 'daily',
        },
        {
            id: 'sleepy_yawn',
            name: 'Sleepy Yawn',
            description: '10-second sleepy yawn animation.',
            nameZh: '哈欠连天',
            descriptionZh: '10 秒桌宠动作：哈欠连天。',
            category: 'daily',
        },
        {
            id: 'quick_nap',
            name: 'Quick Nap',
            description: '10-second quick nap animation.',
            nameZh: '原地小憩沉眠',
            descriptionZh: '10 秒桌宠动作：原地小憩沉眠。',
            category: 'daily',
        },
        {
            id: 'startled_awake',
            name: 'Startled Awake',
            description: '10-second startled awake animation.',
            nameZh: '打瞌睡被惊醒',
            descriptionZh: '10 秒桌宠动作：打瞌睡被惊醒。',
            category: 'daily',
        },
        {
            id: 'morning_brushing',
            name: 'Morning Brushing',
            description: '10-second morning brushing animation.',
            nameZh: '晨间刷牙',
            descriptionZh: '10 秒桌宠动作：晨间刷牙。',
            category: 'daily',
        },
        {
            id: 'mirror_check',
            name: 'Mirror Check',
            description: '10-second mirror check animation.',
            nameZh: '照镜子',
            descriptionZh: '10 秒桌宠动作：照镜子。',
            category: 'daily',
        },
        {
            id: 'outfit_color_try_on',
            name: 'Outfit Color Try-On',
            description: '10-second outfit color try-on animation.',
            nameZh: '整体换装试色',
            descriptionZh: '10 秒桌宠动作：整体换装试色。',
            category: 'daily',
        },
        {
            id: 'attentive_listening',
            name: 'Attentive Listening',
            description: '10-second attentive listening animation.',
            nameZh: '侧耳倾听',
            descriptionZh: '10 秒桌宠动作：侧耳认真倾听。',
            category: 'daily',
        },
        {
            id: 'taking_notes',
            name: 'Taking Notes',
            description: '10-second taking notes animation.',
            nameZh: '轻快记录文字',
            descriptionZh: '10 秒桌宠动作：轻快记录文字。',
            category: 'work',
        },
        {
            id: 'coding',
            name: 'Coding',
            description: '10-second coding animation.',
            nameZh: '写代码',
            descriptionZh: '10 秒桌宠动作：写代码。',
            category: 'work',
        },
        {
            id: 'deep_thought',
            name: 'Deep Thought',
            description: '10-second deep thought animation.',
            nameZh: '深度思考碎碎念',
            descriptionZh: '10 秒桌宠动作：深度思考碎碎念。',
            category: 'work',
        },
        {
            id: 'solving_a_rubiks_cube',
            name: 'Solving a Rubiks Cube',
            description: '10-second solving a rubiks cube animation.',
            nameZh: '专心玩魔方',
            descriptionZh: '10 秒桌宠动作：专心玩魔方。',
            category: 'games',
        },
        {
            id: 'playing_with_a_toy_car',
            name: 'Playing with a Toy Car',
            description: '10-second playing with a toy car animation.',
            nameZh: '蹲下玩玩具汽车',
            descriptionZh: '10 秒桌宠动作：蹲下玩玩具汽车。',
            category: 'games',
        },
        {
            id: 'gaming_rage',
            name: 'Gaming Rage',
            description: '10-second gaming rage animation.',
            nameZh: '玩游戏气急败坏',
            descriptionZh: '10 秒桌宠动作：玩游戏气急败坏。',
            category: 'games',
        },
        {
            id: 'water_gun_play',
            name: 'Water Gun Play',
            description: '10-second water gun play animation.',
            nameZh: '玩水枪',
            descriptionZh: '10 秒桌宠动作：玩水枪。',
            category: 'games',
        },
        {
            id: 'rocking_horse',
            name: 'Rocking Horse',
            description: '10-second rocking horse animation.',
            nameZh: '骑木马',
            descriptionZh: '10 秒桌宠动作：骑木马。',
            category: 'games',
        },
        {
            id: 'kicking_a_shuttlecock',
            name: 'Kicking a Shuttlecock',
            description: '10-second kicking a shuttlecock animation.',
            nameZh: '踢毽子',
            descriptionZh: '10 秒桌宠动作：踢毽子。',
            category: 'games',
        },
        {
            id: 'spinning_a_top',
            name: 'Spinning a Top',
            description: '10-second spinning a top animation.',
            nameZh: '抽陀螺',
            descriptionZh: '10 秒桌宠动作：抽陀螺。',
            category: 'games',
        },
        {
            id: 'playing_gomoku',
            name: 'Playing Gomoku',
            description: '10-second playing gomoku animation.',
            nameZh: '下五子棋',
            descriptionZh: '10 秒桌宠动作：下五子棋。',
            category: 'games',
        },
        {
            id: 'playground_swing',
            name: 'Playground Swing',
            description: '10-second playground swing animation.',
            nameZh: '荡秋千',
            descriptionZh: '10 秒桌宠动作：荡秋千。',
            category: 'games',
        },
        {
            id: 'carefree_humming',
            name: 'Carefree Humming',
            description: '10-second carefree humming animation.',
            nameZh: '悠闲哼歌',
            descriptionZh: '10 秒桌宠动作：悠闲哼歌。',
            category: 'music',
        },
        {
            id: 'playing_the_violin',
            name: 'Playing the Violin',
            description: '10-second playing the violin animation.',
            nameZh: '小提琴演奏',
            descriptionZh: '10 秒桌宠动作：小提琴演奏。',
            category: 'music',
        },
        {
            id: 'elegant_maid_dance',
            name: 'Elegant Maid Dance',
            description: '10-second elegant maid dance animation.',
            nameZh: '优雅女仆舞',
            descriptionZh: '10 秒桌宠动作：优雅女仆舞。',
            category: 'music',
        },
        {
            id: 'light_sway_dance',
            name: 'Light Sway Dance',
            description: '10-second light sway dance animation.',
            nameZh: '轻快摇摆舞',
            descriptionZh: '10 秒桌宠动作：轻快摇摆舞。',
            category: 'music',
        },
        {
            id: 'cute_otaku_dance',
            name: 'Cute Otaku Dance',
            description: '10-second cute otaku dance animation.',
            nameZh: '可爱宅舞',
            descriptionZh: '10 秒桌宠动作：可爱宅舞。',
            category: 'music',
        },
        {
            id: 'playing_the_flute',
            name: 'Playing the Flute',
            description: '10-second playing the flute animation.',
            nameZh: '吹笛子',
            descriptionZh: '10 秒桌宠动作：吹笛子。',
            category: 'music',
        },
        {
            id: 'eating_snacks',
            name: 'Eating Snacks',
            description: '10-second eating snacks animation.',
            nameZh: '大口吃零食',
            descriptionZh: '10 秒桌宠动作：大口吃零食。',
            category: 'food',
        },
        {
            id: 'caught_snacking',
            name: 'Caught Snacking',
            description: '10-second caught snacking animation.',
            nameZh: '偷吃零食被抓住',
            descriptionZh: '10 秒桌宠动作：偷吃零食被抓住。',
            category: 'food',
        },
        {
            id: 'eating_rice',
            name: 'Eating Rice',
            description: '10-second eating rice animation.',
            nameZh: '吃白饭',
            descriptionZh: '10 秒桌宠动作：吃白饭。',
            category: 'food',
        },
        {
            id: 'eating_breakfast',
            name: 'Eating Breakfast',
            description: '10-second eating breakfast animation.',
            nameZh: '吃早餐',
            descriptionZh: '10 秒桌宠动作：吃早餐。',
            category: 'food',
        },
        {
            id: 'eating_lunch',
            name: 'Eating Lunch',
            description: '10-second eating lunch animation.',
            nameZh: '吃午餐',
            descriptionZh: '10 秒桌宠动作：吃午餐。',
            category: 'food',
        },
        {
            id: 'eating_dinner',
            name: 'Eating Dinner',
            description: '10-second eating dinner animation.',
            nameZh: '吃晚餐',
            descriptionZh: '10 秒桌宠动作：吃晚餐。',
            category: 'food',
        },
        {
            id: 'melting_ice_cream',
            name: 'Melting Ice Cream',
            description: '10-second melting ice cream animation.',
            nameZh: '吃冰淇淋融化',
            descriptionZh: '10 秒桌宠动作：吃冰淇淋融化。',
            category: 'food',
        },
        {
            id: 'eating_watermelon',
            name: 'Eating Watermelon',
            description: '10-second eating watermelon animation.',
            nameZh: '吃西瓜',
            descriptionZh: '10 秒桌宠动作：吃西瓜。',
            category: 'food',
        },
        {
            id: 'eating_hotpot',
            name: 'Eating Hotpot',
            description: '10-second eating hotpot animation.',
            nameZh: '涮火锅',
            descriptionZh: '10 秒桌宠动作：涮火锅。',
            category: 'food',
        },
        {
            id: 'eating_hairy_crab',
            name: 'Eating Hairy Crab',
            description: '10-second eating hairy crab animation.',
            nameZh: '吃大闸蟹',
            descriptionZh: '10 秒桌宠动作：吃大闸蟹。',
            category: 'food',
        },
        {
            id: 'eating_candied_haw',
            name: 'Eating Candied Haw',
            description: '10-second eating candied haw animation.',
            nameZh: '吃糖葫芦',
            descriptionZh: '10 秒桌宠动作：吃糖葫芦。',
            category: 'food',
        },
        {
            id: 'eating_longevity_noodles',
            name: 'Eating Longevity Noodles',
            description: '10-second eating longevity noodles animation.',
            nameZh: '吃长寿面',
            descriptionZh: '10 秒桌宠动作：吃长寿面。',
            category: 'food',
        },
        {
            id: 'moon_festival',
            name: 'Moon Festival',
            description: '10-second moon festival animation.',
            nameZh: '中秋赏月吃月饼',
            descriptionZh: '10 秒桌宠动作：中秋赏月吃月饼。',
            category: 'festivals',
        },
        {
            id: 'setting_off_fireworks',
            name: 'Setting Off Fireworks',
            description: '10-second setting off fireworks animation.',
            nameZh: '放烟花',
            descriptionZh: '10 秒桌宠动作：放烟花。',
            category: 'festivals',
        },
        {
            id: 'opening_a_gift',
            name: 'Opening a Gift',
            description: '10-second opening a gift animation.',
            nameZh: '拆礼物',
            descriptionZh: '10 秒桌宠动作：拆礼物。',
            category: 'festivals',
        },
        {
            id: 'eating_zongzi',
            name: 'Eating Zongzi',
            description: '10-second eating zongzi animation.',
            nameZh: '吃粽子',
            descriptionZh: '10 秒桌宠动作：吃粽子。',
            category: 'festivals',
        },
        {
            id: 'eating_tangyuan',
            name: 'Eating Tangyuan',
            description: '10-second eating tangyuan animation.',
            nameZh: '吃汤圆',
            descriptionZh: '10 秒桌宠动作：吃汤圆。',
            category: 'festivals',
        },
        {
            id: 'eating_dumplings',
            name: 'Eating Dumplings',
            description: '10-second eating dumplings animation.',
            nameZh: '吃饺子',
            descriptionZh: '10 秒桌宠动作：吃饺子。',
            category: 'festivals',
        },
        {
            id: 'eating_qingtuan',
            name: 'Eating Qingtuan',
            description: '10-second eating qingtuan animation.',
            nameZh: '吃青团',
            descriptionZh: '10 秒桌宠动作：吃青团。',
            category: 'festivals',
        },
        {
            id: 'eating_laba_congee',
            name: 'Eating Laba Congee',
            description: '10-second eating laba congee animation.',
            nameZh: '吃腊八粥',
            descriptionZh: '10 秒桌宠动作：吃腊八粥。',
            category: 'festivals',
        },
        {
            id: 'eating_rice_cake',
            name: 'Eating Rice Cake',
            description: '10-second eating rice cake animation.',
            nameZh: '吃年糕',
            descriptionZh: '10 秒桌宠动作：吃年糕。',
            category: 'festivals',
        },
        {
            id: 'eating_chongyang_cake',
            name: 'Eating Chongyang Cake',
            description: '10-second eating chongyang cake animation.',
            nameZh: '吃重阳糕',
            descriptionZh: '10 秒桌宠动作：吃重阳糕。',
            category: 'festivals',
        },
        {
            id: 'receiving_a_red_envelope',
            name: 'Receiving a Red Envelope',
            description: '10-second receiving a red envelope animation.',
            nameZh: '收红包',
            descriptionZh: '10 秒桌宠动作：收红包。',
            category: 'festivals',
        },
        {
            id: 'lion_dance',
            name: 'Lion Dance',
            description: '10-second lion dance animation.',
            nameZh: '舞狮头',
            descriptionZh: '10 秒桌宠动作：舞狮头。',
            category: 'festivals',
        },
        {
            id: 'writing_the_fu_character',
            name: 'Writing the Fu Character',
            description: '10-second writing the fu character animation.',
            nameZh: '写福字',
            descriptionZh: '10 秒桌宠动作：写福字。',
            category: 'festivals',
        },
        {
            id: 'qixi_needlework',
            name: 'Qixi Needlework',
            description: '10-second qixi needlework animation.',
            nameZh: '穿针乞巧',
            descriptionZh: '10 秒桌宠动作：穿针乞巧。',
            category: 'festivals',
        },
        {
            id: 'decorating_a_christmas_tree',
            name: 'Decorating a Christmas Tree',
            description: '10-second decorating a christmas tree animation.',
            nameZh: '装点圣诞树',
            descriptionZh: '10 秒桌宠动作：装点圣诞树。',
            category: 'festivals',
        },
        {
            id: 'halloween_trick_or_treat',
            name: 'Halloween Trick-or-Treat',
            description: '10-second halloween trick-or-treat animation.',
            nameZh: '讨糖南瓜灯',
            descriptionZh: '10 秒桌宠动作：讨糖南瓜灯。',
            category: 'festivals',
        },
        {
            id: 'chongyang_chrysanthemums',
            name: 'Chongyang Chrysanthemums',
            description: '10-second chongyang chrysanthemums animation.',
            nameZh: '插茱萸赏菊',
            descriptionZh: '10 秒桌宠动作：插茱萸赏菊。',
            category: 'festivals',
        },
        {
            id: 'releasing_a_river_lantern',
            name: 'Releasing a River Lantern',
            description: '10-second releasing a river lantern animation.',
            nameZh: '放河灯',
            descriptionZh: '10 秒桌宠动作：放河灯。',
            category: 'festivals',
        },
        {
            id: 'cute_little_ghost',
            name: 'Cute Little Ghost',
            description: '10-second cute little ghost animation.',
            nameZh: '萌化小幽灵',
            descriptionZh: '10 秒桌宠动作：萌化小幽灵。',
            category: 'festivals',
        },
        {
            id: 'releasing_a_sky_lantern',
            name: 'Releasing a Sky Lantern',
            description: '10-second releasing a sky lantern animation.',
            nameZh: '放孔明灯',
            descriptionZh: '10 秒桌宠动作：放孔明灯。',
            category: 'festivals',
        },
        {
            id: 'building_a_snowman',
            name: 'Building a Snowman',
            description: '10-second building a snowman animation.',
            nameZh: '堆雪人',
            descriptionZh: '10 秒桌宠动作：堆雪人。',
            category: 'seasonal',
        },
        {
            id: 'cooling_with_a_hand_fan',
            name: 'Cooling with a Hand Fan',
            description: '10-second cooling with a hand fan animation.',
            nameZh: '摇扇纳凉',
            descriptionZh: '10 秒桌宠动作：摇扇纳凉。',
            category: 'seasonal',
        },
        {
            id: 'buried_in_autumn_leaves',
            name: 'Buried in Autumn Leaves',
            description: '10-second buried in autumn leaves animation.',
            nameZh: '被落叶淹没',
            descriptionZh: '10 秒桌宠动作：被落叶淹没。',
            category: 'seasonal',
        },
        {
            id: 'flying_a_kite',
            name: 'Flying a Kite',
            description: '10-second flying a kite animation.',
            nameZh: '放风筝',
            descriptionZh: '10 秒桌宠动作：放风筝。',
            category: 'seasonal',
        },
        {
            id: 'dove_magic',
            name: 'Dove Magic',
            description: '10-second dove magic animation.',
            nameZh: '变鸽子魔术',
            descriptionZh: '10 秒桌宠动作：变鸽子魔术。',
            category: 'magic',
        },
        {
            id: 'flower_conjuring',
            name: 'Flower Conjuring',
            description: '10-second flower conjuring animation.',
            nameZh: '凭空生花魔术',
            descriptionZh: '10 秒桌宠动作：凭空生花魔术。',
            category: 'magic',
        },
        {
            id: 'card_magic',
            name: 'Card Magic',
            description: '10-second card magic animation.',
            nameZh: '扑克魔术',
            descriptionZh: '10 秒桌宠动作：扑克魔术。',
            category: 'magic',
        },
        {
            id: 'inflating_a_balloon',
            name: 'Inflating a Balloon',
            description: '10-second inflating a balloon animation.',
            nameZh: '吹气球',
            descriptionZh: '10 秒桌宠动作：吹气球。',
            category: 'fun',
        },
        {
            id: 'animal_parade',
            name: 'Animal Parade',
            description: '10-second animal parade animation.',
            nameZh: '动物环绕',
            descriptionZh: '10 秒桌宠动作：动物环绕。',
            category: 'fun',
        },
        {
            id: 'three_ball_juggling',
            name: 'Three-Ball Juggling',
            description: '10-second three-ball juggling animation.',
            nameZh: '三球抛接',
            descriptionZh: '10 秒桌宠动作：三球抛接。',
            category: 'fun',
        },
        {
            id: 'butterflies_and_blossoms',
            name: 'Butterflies and Blossoms',
            description: '10-second butterflies and blossoms animation.',
            nameZh: '蝴蝶蜜蜂环绕头顶开花',
            descriptionZh: '10 秒桌宠动作：蝴蝶蜜蜂环绕头顶开花。',
            category: 'fun',
        },
        {
            id: 'petting_a_cat',
            name: 'Petting a Cat',
            description: '10-second petting a cat animation.',
            nameZh: '撸猫',
            descriptionZh: '10 秒桌宠动作：撸猫。',
            category: 'fun',
        },
        {
            id: 'jump_and_smash',
            name: 'Jump and Smash',
            description: '10-second jump and smash animation.',
            nameZh: '原地跳跃抓碎头顶物品',
            descriptionZh: '10 秒桌宠动作：原地跳跃抓碎头顶物品。',
            category: 'fun',
        },
        {
            id: 'whale_bubbles',
            name: 'Whale Bubbles',
            description: '10-second whale bubbles animation.',
            nameZh: '鲸鱼吐泡泡特效',
            descriptionZh: '10 秒桌宠动作：鲸鱼吐泡泡特效。',
            category: 'special',
        },
        {
            id: 'blue_whale_appears',
            name: 'Blue Whale Appears',
            description: '10-second blue whale appears animation.',
            nameZh: '蓝鲸现世',
            descriptionZh: '10 秒桌宠动作：蓝鲸现世。',
            category: 'special',
        },
        {
            id: 'whale_tail_slap',
            name: 'Whale Tail Slap',
            description: '10-second whale tail slap animation.',
            nameZh: '用鲸鱼尾巴拍打地面',
            descriptionZh: '10 秒桌宠动作：用鲸鱼尾巴拍打地面。',
            category: 'special',
        },
        {
            id: 'desk_tap',
            name: 'Desk Tap',
            description: '10-second desk tap animation.',
            nameZh: '敲击桌面互动',
            descriptionZh: '10 秒桌宠动作：敲击桌面互动。',
            category: 'fun',
        },
        {
            id: 'gravity_squash',
            name: 'Gravity Squash',
            description: '10-second gravity squash animation.',
            nameZh: '重力下蹲压缩',
            descriptionZh: '10 秒桌宠动作：重力下蹲压缩。',
            category: 'fun',
        },
        {
            id: 'jump_scare',
            name: 'Jump Scare',
            description: '10-second jump scare animation.',
            nameZh: '被吓一跳',
            descriptionZh: '10 秒桌宠动作：被吓一跳。',
            category: 'fun',
        },
        {
            id: 'eating_tokens',
            name: 'Eating Tokens',
            description: '10-second eating tokens animation.',
            nameZh: '吃 Token',
            descriptionZh: '10 秒桌宠动作：吃 Token。',
            category: 'memes',
        },
        {
            id: 'yeah_what_should_we_eat',
            name: 'Yeah, What Should We Eat?',
            description: '10-second yeah, what should we eat? animation.',
            nameZh: '是啊，吃什么？',
            descriptionZh: '10 秒桌宠动作：是啊，吃什么？',
            category: 'memes',
        },
    ];
    var LEGACY_ANIM_IDS = {
        idle_breathe: 'breathing',
        turn_look: 'looking_around',
        move_float: 'floating_steps',
        move_crab: 'crab_walk',
        move_run_trip: 'running_trip',
        click_happy: 'happy_hop',
        click_shy: 'shy_surprise',
        click_tsundere: 'tsundere_pout',
        click_tickle: 'ticklish_giggle',
        act_wave: 'cheerful_wave',
        drag_hang: 'dragged_in_midair',
        act_curtsy: 'maid_curtsy',
        act_stretch: 'big_stretch',
        act_spin: 'gentle_spin',
        act_yawn: 'sleepy_yawn',
        act_nap: 'quick_nap',
        act_awake: 'startled_awake',
        daily_brush_teeth: 'morning_brushing',
        act_mirror: 'mirror_check',
        act_costume: 'outfit_color_try_on',
        act_notes: 'taking_notes',
        act_code: 'coding',
        act_deep_think: 'deep_thought',
        act_rubik: 'solving_a_rubiks_cube',
        act_toy_car: 'playing_with_a_toy_car',
        act_game_frustrated: 'gaming_rage',
        act_water_gun: 'water_gun_play',
        games_rocking_horse: 'rocking_horse',
        games_shuttlecock: 'kicking_a_shuttlecock',
        games_spinning_top: 'spinning_a_top',
        games_gomoku: 'playing_gomoku',
        games_swing: 'playground_swing',
        act_hum: 'carefree_humming',
        act_violin: 'playing_the_violin',
        act_maid_dance: 'elegant_maid_dance',
        act_swing: 'light_sway_dance',
        act_cute_dance: 'cute_otaku_dance',
        music_flute: 'playing_the_flute',
        act_snack: 'eating_snacks',
        act_snack_caught: 'caught_snacking',
        act_rice: 'eating_rice',
        act_breakfast: 'eating_breakfast',
        act_lunch: 'eating_lunch',
        act_dinner: 'eating_dinner',
        act_ice_cream: 'melting_ice_cream',
        food_watermelon: 'eating_watermelon',
        food_hotpot: 'eating_hotpot',
        food_hairy_crab: 'eating_hairy_crab',
        food_candied_haw: 'eating_candied_haw',
        food_longevity_noodles: 'eating_longevity_noodles',
        act_mooncake: 'moon_festival',
        festival_fireworks: 'setting_off_fireworks',
        festival_gift: 'opening_a_gift',
        festival_zongzi: 'eating_zongzi',
        festival_tangyuan: 'eating_tangyuan',
        festival_dumplings: 'eating_dumplings',
        festival_qingtuan: 'eating_qingtuan',
        festival_laba_congee: 'eating_laba_congee',
        festival_rice_cake: 'eating_rice_cake',
        festival_chongyang_cake: 'eating_chongyang_cake',
        festival_red_envelope: 'receiving_a_red_envelope',
        festival_lion_dance: 'lion_dance',
        festival_fu_calligraphy: 'writing_the_fu_character',
        festival_qixi_needlework: 'qixi_needlework',
        festival_christmas_tree: 'decorating_a_christmas_tree',
        festival_halloween: 'halloween_trick_or_treat',
        festival_chongyang: 'chongyang_chrysanthemums',
        festival_river_lantern: 'releasing_a_river_lantern',
        festival_cute_ghost: 'cute_little_ghost',
        festival_sky_lantern: 'releasing_a_sky_lantern',
        act_snowman: 'building_a_snowman',
        act_fan: 'cooling_with_a_hand_fan',
        act_leaves: 'buried_in_autumn_leaves',
        act_kite: 'flying_a_kite',
        magic_dove: 'dove_magic',
        magic_flower: 'flower_conjuring',
        magic_cards: 'card_magic',
        act_balloon: 'inflating_a_balloon',
        act_animals: 'animal_parade',
        fun_juggling: 'three_ball_juggling',
        fun_butterflies_blossom: 'butterflies_and_blossoms',
        fun_pet_cat: 'petting_a_cat',
        act_jump_smash: 'jump_and_smash',
        act_bubble: 'whale_bubbles',
        act_blue_whale: 'blue_whale_appears',
        act_tail_slap: 'whale_tail_slap',
        act_desk_tap: 'desk_tap',
        act_squash: 'gravity_squash',
        act_startle: 'jump_scare',
        act_token: 'eating_tokens',
        act_listen: 'attentive_listening',
        act_read: 'taking_notes',
        act_celebrate: 'happy_hop',
        act_search: 'deep_thought',
        act_shrug: 'gravity_squash',
        act_confused: 'deep_thought',
        // 0.1.0 后移除的异画风动作：迁移已持久化的英文 ID，避免播放空 URL。
        searching: 'deep_thought',
        reading_book: 'taking_notes',
        confused_head_shake: 'deep_thought',
        helpless_shrug: 'gravity_squash',
        celebration: 'happy_hop',
        move_run: 'running_trip',
        meme_what_to_eat: 'yeah_what_should_we_eat',
    };
    // 索引：英文 id → 条目 / 英文名称 → 条目
    var ANIM_BY_ID = {};
    var ANIM_BY_NAME = {};
    ANIMS.forEach((a) => {
        ANIM_BY_ID[a.id] = a;
        ANIM_BY_NAME[a.name] = a;
        ANIM_BY_NAME[a.nameZh] = a;
    });

    // ---- 自定义动作注册表（资源层） ----
    // 宿主扫描 $DSH_HOME/whale-pet/actions/ 下的 WebM/MP4，经
    // /whale-pet/api/actions 下发；这里维护 id → 元数据 的注册表，
    // 供 animUrl/animName/动画选择器统一解析。自定义动作视作 acts
    // 语义（可入动作池/意图映射；不参与移动/点击/拖拽的专用逻辑）。
    var customById = {};
    // 同路径替换过的内置资源需带版本号，避免浏览器继续播放旧缓存。
    var BUILTIN_ASSET_REVISIONS = {
        target_point_run: '20260823-1',
        arrival_wave: '20260823-1',
        attentive_listening: '20260823-1',
        turn_into_ball: '20260826-1',
    };
    /** 批量更新自定义动作注册表（来自 /whale-pet/api/actions 的 actions 数组） */
    var setCustomAnims = (list) => {
        customById = {};
        (list || []).forEach((a) => {
            if (a && a.id) customById[a.id] = a;
        });
    };
    /** 统一取动画条目：内置 → ANIMS 条目；自定义 → 合成 {id,name,category:'custom'}；未知 → null */
    var animEntry = (id) => {
        var a = ANIM_BY_ID[id];
        if (a) return a;
        return customById[id] ? { id: id, name: id, category: 'custom' } : null;
    };
    // 播放 URL：内置 /whale-pet/<分类>/<id>.webm；自定义 /whale-pet/custom/<id>.<ext>
    var animUrl = (id) => {
        var a = ANIM_BY_ID[id];
        if (a) {
            var revision = BUILTIN_ASSET_REVISIONS[id];
            return (
                '/whale-pet/' +
                a.category +
                '/' +
                a.id +
                '.webm' +
                (revision ? '?v=' + encodeURIComponent(revision) : '')
            );
        }
        var c = customById[id];
        return c
            ? '/whale-pet/custom/' +
                  encodeURIComponent(id) +
                  '.' +
                  (c.ext || 'webm') +
                  '?v=' +
                  encodeURIComponent(String(c.mtime || 0))
            : '';
    };
    // id → 显示名（UI 用）；自定义动作显示文件名；未知 id 原样返回
    var animName = (id) => {
        var a = ANIM_BY_ID[id];
        return a ? a.name : id;
    };
    var animDescription = (id) => {
        var a = ANIM_BY_ID[id];
        return a ? a.description : '';
    };
    var localizedAnimName = (id, t) => {
        var a = ANIM_BY_ID[id];
        return a && t ? t('animName_' + id) : animName(id);
    };
    var localizedAnimDescription = (id, t) => {
        var a = ANIM_BY_ID[id];
        return a && t ? t('animDescription_' + id) : '';
    };
    // 旧配置迁移：旧版带分类前缀的英文 id / 旧名称 → 新英文 id（settings.yaml 里可能存有旧值）
    var normalizeAnimId = (v) => {
        if (ANIM_BY_ID[v]) return v;
        if (LEGACY_ANIM_IDS[v]) return LEGACY_ANIM_IDS[v];
        var a = ANIM_BY_NAME[v];
        return a ? a.id : v;
    };

    return {
        CANVAS_W,
        CANVAS_H,
        FEET_Y,
        HIT_BOX,
        ANIMS,
        ANIM_BY_ID,
        ANIM_BY_NAME,
        BUILTIN_ASSET_REVISIONS,
        setCustomAnims,
        animEntry,
        animUrl,
        animName,
        animDescription,
        localizedAnimName,
        localizedAnimDescription,
        normalizeAnimId,
    };
}
