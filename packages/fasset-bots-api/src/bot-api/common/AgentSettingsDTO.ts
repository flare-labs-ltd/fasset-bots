import { ApiProperty } from "@nestjs/swagger";

export class AgentSettingsDTO {
    @ApiProperty()
    name: string = "";

    @ApiProperty()
    value: string = "";
}

export class PasswordDTO {
    @ApiProperty()
    password: string = "";
}


export class PostAlert {
    @ApiProperty()
    bot_type: string = "";
    @ApiProperty()
    address: string = "";
    @ApiProperty()
    level: string = "";
    @ApiProperty()
    title: string = "";
    @ApiProperty()
    description: string = "";
}

export class Alerts {
    @ApiProperty()
    alerts: PostAlert[] = [];
    @ApiProperty()
    count: number = 0;
}
