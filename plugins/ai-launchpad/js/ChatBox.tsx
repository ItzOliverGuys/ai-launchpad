import { useState } from 'react'
import {
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import type { ChatAttachment, ProviderType } from './providers'

export interface ModelOption {
	id: string
	label: string
	provider: ProviderType
}

interface ChatBoxProps {
	models: ModelOption[]
	selectedModel: ModelOption
	onSelectModel: (model: ModelOption) => void
	onPickPhoto: () => Promise<ChatAttachment | null>
	onPickFile: () => Promise<ChatAttachment | null>
	onSummarizeContext: () => void
	onSend: (text: string, attachments: ChatAttachment[]) => void
}

export function ChatBox({
	models,
	selectedModel,
	onSelectModel,
	onPickPhoto,
	onPickFile,
	onSummarizeContext,
	onSend,
}: ChatBoxProps) {
	const [text, setText] = useState('')
	const [attachments, setAttachments] = useState<ChatAttachment[]>([])
	const [menu, setMenu] = useState<'plus' | 'model' | null>(null)

	const handleAttach = async (picker: () => Promise<ChatAttachment | null>) => {
		setMenu(null)
		const item = await picker()
		if (item) setAttachments(prev => [...prev, item])
	}

	const handleSend = () => {
		if (!text.trim() && attachments.length === 0) return
		onSend(text.trim(), attachments)
		setText('')
		setAttachments([])
	}

	return (
		<View style={styles.wrapper}>
			{menu === 'plus' && (
				<View style={styles.popover}>
					<TouchableOpacity
						style={styles.popoverItem}
						onPress={() => handleAttach(onPickPhoto)}
					>
						<Text style={styles.popoverText}>Add Photo</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.popoverItem}
						onPress={() => handleAttach(onPickFile)}
					>
						<Text style={styles.popoverText}>Add File</Text>
					</TouchableOpacity>
					<TouchableOpacity
						style={styles.popoverItem}
						onPress={() => {
							setMenu(null)
							onSummarizeContext()
						}}
					>
						<Text style={styles.popoverText}>Summarize Channel Context</Text>
					</TouchableOpacity>
				</View>
			)}

			{menu === 'model' && (
				<View style={styles.popover}>
					{models.map(m => (
						<TouchableOpacity
							key={`${m.provider}:${m.id}`}
							style={styles.popoverItem}
							onPress={() => {
								onSelectModel(m)
								setMenu(null)
							}}
						>
							<Text
								style={[
									styles.popoverText,
									m.id === selectedModel.id &&
										m.provider === selectedModel.provider &&
										styles.active,
								]}
							>
								{m.label} ({m.provider})
							</Text>
						</TouchableOpacity>
					))}
				</View>
			)}

			<View style={styles.composer}>
				{attachments.length > 0 && (
					<ScrollView
						horizontal
						style={styles.previewRow}
						showsHorizontalScrollIndicator={false}
					>
						{attachments.map(att => (
							<View key={att.id} style={styles.chip}>
								<Text style={styles.chipText} numberOfLines={1}>
									{att.name}
								</Text>
								<TouchableOpacity
									onPress={() =>
										setAttachments(p => p.filter(x => x.id !== att.id))
									}
								>
									<Text style={styles.remove}>x</Text>
								</TouchableOpacity>
							</View>
						))}
					</ScrollView>
				)}

				<TextInput
					style={styles.input}
					value={text}
					onChangeText={setText}
					placeholder="Ask AI anything..."
					placeholderTextColor="#8e9297"
					multiline
				/>

				<View style={styles.bottomBar}>
					<View style={styles.bottomLeft}>
						<TouchableOpacity
							style={styles.plusBtn}
							onPress={() => setMenu(m => (m === 'plus' ? null : 'plus'))}
						>
							<Text style={styles.plusText}>+</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={styles.modelBtn}
							onPress={() => setMenu(m => (m === 'model' ? null : 'model'))}
						>
							<Text style={styles.modelText}>{selectedModel.label} v</Text>
						</TouchableOpacity>
					</View>

					<TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
						<Text style={styles.sendText}>^</Text>
					</TouchableOpacity>
				</View>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	wrapper: { padding: 8, backgroundColor: '#1e1f22' },
	popover: { backgroundColor: '#2b2d31', borderRadius: 12, padding: 4, marginBottom: 6 },
	popoverItem: { paddingHorizontal: 12, paddingVertical: 9 },
	popoverText: { color: '#dbdee1', fontSize: 13 },
	active: { color: '#5865f2', fontWeight: '700' },
	composer: { backgroundColor: '#2b2d31', borderRadius: 16, padding: 10 },
	previewRow: { flexDirection: 'row', marginBottom: 6 },
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#1e1f22',
		borderRadius: 10,
		paddingHorizontal: 8,
		paddingVertical: 4,
		marginRight: 6,
	},
	chipText: { color: '#dbdee1', fontSize: 12, maxWidth: 120 },
	remove: { color: '#949ba4', marginLeft: 6, fontSize: 12 },
	input: {
		minHeight: 38,
		maxHeight: 120,
		color: '#f2f3f5',
		fontSize: 14,
		paddingHorizontal: 4,
		paddingTop: 2,
		paddingBottom: 8,
	},
	bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	bottomLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	plusBtn: {
		width: 30,
		height: 30,
		borderRadius: 15,
		backgroundColor: '#383a40',
		alignItems: 'center',
		justifyContent: 'center',
	},
	plusText: { color: '#dbdee1', fontSize: 18, lineHeight: 20, fontWeight: '600' },
	modelBtn: {
		backgroundColor: '#383a40',
		borderRadius: 14,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	modelText: { color: '#dbdee1', fontSize: 12, fontWeight: '600' },
	sendBtn: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: '#5865f2',
		alignItems: 'center',
		justifyContent: 'center',
	},
	sendText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
})
