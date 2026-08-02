import 'package:flutter/material.dart';

enum LegalDocumentType { terms, privacy }

class LegalDocumentPage extends StatelessWidget {
  const LegalDocumentPage({required this.type, super.key});

  final LegalDocumentType type;

  @override
  Widget build(BuildContext context) {
    final isTerms = type == LegalDocumentType.terms;
    final sections = isTerms ? _termsSections : _privacySections;
    return Scaffold(
      backgroundColor: const Color(0xFFF6F1E8),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF6F1E8),
        title: Text(isTerms ? '树皮用户协议' : '树皮隐私说明'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Text(
            isTerms ? '树皮用户协议' : '树皮隐私说明',
            style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          const Text(
            '上线候选版 · 更新日期：2026年8月1日',
            style: TextStyle(color: Color(0xFF817A74)),
          ),
          const SizedBox(height: 22),
          for (final section in sections)
            Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    section.$1,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    section.$2,
                    style: const TextStyle(
                      color: Color(0xFF5E5853),
                      height: 1.7,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

const _termsSections = [
  (
    '1. 服务范围',
    '树皮提供 AI 穿搭分析、商品推荐和个人衣柜服务。AI 结果仅用于穿搭参考，不构成医疗、健康或专业尺码承诺。',
  ),
  (
    '2. 账号与内容',
    '用户应妥善保管账号，不得上传无权使用的照片或违法内容。用户可以编辑资料、退出登录，并通过账号中心永久注销账号。',
  ),
  (
    '3. 商品与购买',
    '商品交易在品牌或联盟合作方页面完成。实际价格、库存、支付、配送、退换货与售后以合作方页面为准；树皮可能从合规购买跳转中获得佣金。',
  ),
  (
    '4. 服务变更与联系',
    '测试期间功能可能调整或暂停。公开发布前，运营方必须补充主体名称、联系邮箱、注册地址和争议处理方式，并完成法律审核。',
  ),
];

const _privacySections = [
  (
    '1. 收集的数据',
    '包括账号资料、身高体重、穿搭偏好、定位与天气城市、用户主动上传的照片，以及曝光、点击、收藏、试穿和购买跳转等行为事件。',
  ),
  (
    '2. 使用目的',
    '数据用于生成穿搭结果、同步个人衣柜、改进推荐、保障账号安全和衡量商品转化。服务日志禁止记录 Base64 图片、密码、访问令牌或完整敏感请求体。',
  ),
  (
    '3. 存储与第三方处理',
    '账号数据和照片可存储在运营方配置的云数据库与私有对象存储中；照片还可能发送给已披露的 AI 服务商进行分析。正式上线前必须补充服务商名称、存储地区、保存期限和跨境情况。',
  ),
  (
    '4. 用户权利与删除',
    '用户可以查看和修改资料、撤回照片处理授权、删除本地照片，并在账号中心注销账号。注销会请求服务端删除账号、衣柜、行为记录和私有对象存储中的照片；法律要求保留的数据除外。',
  ),
  (
    '5. 权限说明',
    '相机和相册权限仅在选择照片时申请；定位权限用于获取城市天气，拒绝后仍可手动选择城市。权限可以在系统设置中随时关闭。',
  ),
];
