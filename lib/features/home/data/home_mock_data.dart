import '../models/home_content.dart';
import 'package:flutter/material.dart';

abstract final class HomeMockData {
  static const categories = [
    '通勤',
    '约会',
    '运动',
    '街头',
    '高级感',
    '极简',
    '商务',
    '休闲',
  ];

  static const inspirations = [
    OutfitInspiration(
      id: 'business-commute',
      title: '30岁男性通勤高级感',
      imageAsset: 'assets/images/home/business_commute.jpg',
      tags: ['商务', '极简'],
      views: '12.8万',
      categories: ['通勤', '商务', '极简'],
      imageAspectRatio: 2 / 3,
      aiReason: '纵向裤线与短外套共同提高腰线，视觉更利落。',
      audience: '适合170–178cm、重视通勤质感的人',
    ),
    OutfitInspiration(
      id: 'date-night',
      title: '提升第一印象的约会搭配',
      imageAsset: 'assets/images/home/date_night.jpg',
      tags: ['约会', '氛围感'],
      views: '9.6万',
      categories: ['约会', '极简'],
      imageAspectRatio: 2 / 3,
      aiReason: '柔和领口与深浅层次能提升面部关注度。',
      audience: '适合偏瘦体型、需要约会氛围感的人',
    ),
    OutfitInspiration(
      id: 'summer-clean',
      title: '夏季清爽高级感',
      imageAsset: 'assets/images/home/summer_clean.jpg',
      tags: ['夏日', '清爽'],
      views: '8.4万',
      categories: ['休闲', '约会'],
      imageAspectRatio: 2 / 3,
      aiReason: '轻面料和低对比配色减少夏季造型重量。',
      audience: '适合日常休闲、喜欢清爽配色的人',
    ),
    OutfitInspiration(
      id: 'street-graphite',
      title: '城市街头的松弛层次',
      imageAsset: 'assets/images/home/street_graphite.jpg',
      tags: ['街头', '层次感'],
      views: '7.9万',
      categories: ['街头', '通勤'],
      imageAspectRatio: 2 / 3,
      aiReason: '上宽下直的轮廓能加强肩部存在感。',
      audience: '适合窄肩、喜欢街头层次的人',
    ),
    OutfitInspiration(
      id: 'minimal-monochrome',
      title: '黑灰同色系怎么穿不沉闷',
      imageAsset: 'assets/images/home/minimal_monochrome.jpg',
      tags: ['极简', '同色系'],
      views: '6.7万',
      categories: ['极简', '商务', '高级感'],
      imageAspectRatio: 2 / 3,
      aiReason: '同色系通过材质差异建立高级层次。',
      audience: '适合追求克制高级感的通勤人群',
    ),
    OutfitInspiration(
      id: 'korean-soft',
      title: '温柔韩系的轻盈比例',
      imageAsset: 'assets/images/home/korean_soft.jpg',
      tags: ['韩系', '温柔'],
      views: '10.2万',
      categories: ['休闲', '约会', '通勤'],
      imageAspectRatio: 2 / 3,
      aiReason: '柔软廓形能够弱化身体棱角，提升亲和力。',
      audience: '适合轻熟风格与温柔约会场景',
    ),
  ];

  static const brands = [
    FeaturedBrand(
      name: 'UNIQLO',
      shortName: 'U',
      backgroundColor: Color(0xFFF2ECE8),
      foregroundColor: Color(0xFF9A3D2D),
    ),
    FeaturedBrand(
      name: 'COS',
      shortName: 'C',
      backgroundColor: Color(0xFFE9ECED),
      foregroundColor: Color(0xFF273238),
    ),
    FeaturedBrand(
      name: 'ZARA',
      shortName: 'Z',
      backgroundColor: Color(0xFFF0EDE8),
      foregroundColor: Color(0xFF201E1B),
    ),
    FeaturedBrand(
      name: 'NIKE',
      shortName: 'N',
      backgroundColor: Color(0xFFE8E9E5),
      foregroundColor: Color(0xFF252620),
    ),
    FeaturedBrand(
      name: 'adidas',
      shortName: 'a',
      backgroundColor: Color(0xFFE7EBF0),
      foregroundColor: Color(0xFF26384D),
    ),
    FeaturedBrand(
      name: 'Ralph Lauren',
      shortName: 'RL',
      backgroundColor: Color(0xFFEAE4DC),
      foregroundColor: Color(0xFF24384A),
    ),
  ];
}
