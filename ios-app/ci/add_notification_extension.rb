# 알림 확장(NotificationService) 타깃을 ios/App/App.xcodeproj 에 넣고 App 에 심는다 (2026-11-02)
# 실행 위치: ios-app/ios/App (macOS 러너 — CocoaPods 가 xcodeproj gem 을 같이 깔아 둔다). 먼저 NotificationService/ 폴더에 .swift·Info.plist 가 복사돼 있어야 한다.
require 'xcodeproj'
NAME = 'NotificationService'
BID  = 'com.wontsbe.momcalendar.NotificationService'
proj = Xcodeproj::Project.open('App.xcodeproj')
app  = proj.targets.find { |t| t.name == 'App' } or abort('🔴 App 타깃을 못 찾음')
abort('🔴 이미 확장이 있다') if proj.targets.any? { |t| t.name == NAME }

ext = proj.new_target(:app_extension, NAME, :ios, '15.0')
group = proj.main_group.new_group(NAME, NAME)
swift = group.new_file('NotificationService.swift')
group.new_file('Info.plist')
ext.add_file_references([swift])

app_cfg = app.build_configurations.to_h { |c| [c.name, c.build_settings] }
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BID
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = "#{NAME}/Info.plist"
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['SKIP_INSTALL'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['LD_RUNPATH_SEARCH_PATHS'] = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  a = app_cfg[c.name] || {}
  s['MARKETING_VERSION'] = a['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = a['CURRENT_PROJECT_VERSION'] || '1'
end

embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } || app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(ext.product_reference, true)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app.add_dependency(ext)
proj.save
puts "✅ #{NAME} 타깃 추가(#{BID}) — App 에 임베드"
